import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { RunningDevice, deviceLabel, getAllRunningDevices } from '../utils/devices.js';
import { selectWithExit, spinner } from '../utils/prompt.js';

interface PushOptions {
  ios?: string | boolean;
  bundleId?: string;
  template?: boolean;
}

type IosSimulator = Extract<RunningDevice, { platform: 'ios'; kind: 'simulator' }>;

const TEMPLATE = {
  aps: {
    alert: { title: 'Order update', body: 'Your laundry is on the way 🚚' },
    sound: 'default',
    badge: 1,
  },
  order_uuid: 'REPLACE_ME',
  redirect: 'RC',
};

function explainSimulatorOnly(): void {
  console.error(chalk.red('Push notifications can only be sent to an iOS simulator.'));
  console.error(
    chalk.gray(
      "`simctl push` injects a notification into a simulator; a real device can only receive one\n" +
        'through APNs (iOS) or FCM (Android) — which needs push credentials and the device token.',
    ),
  );
  console.error(chalk.gray('Boot a simulator with `simon launch -i`, or use the Firebase console for real-device tests.'));
}

export async function pushCommand(payload: string | undefined, options: PushOptions): Promise<void> {
  if (options.template) {
    console.log(JSON.stringify(TEMPLATE, null, 2));
    if (process.stdout.isTTY) {
      console.error(chalk.gray('\nSave it to a file, then: simon push <file> -b <bundle-id>'));
    }
    return;
  }

  if (!payload) {
    console.error(chalk.red('Provide a payload file, or use --template to print an example.'));
    process.exit(1);
  }
  if (!existsSync(payload)) {
    console.error(chalk.red(`Payload file not found: ${payload}`));
    process.exit(1);
  }

  const name = typeof options.ios === 'string' ? options.ios : undefined;

  const stop = spinner('Loading devices...');
  const all = await getAllRunningDevices();
  stop();

  const sims = all.filter((d): d is IosSimulator => d.platform === 'ios' && d.kind === 'simulator');

  // Aiming at a named real device (physical or Android) → explain, don't fail cryptically.
  if (name) {
    const target = all.find(
      d => d.name === name || ('udid' in d && d.udid === name) || ('serial' in d && d.serial === name),
    );
    if (target && (target.kind === 'physical' || target.platform === 'android')) {
      explainSimulatorOnly();
      process.exit(1);
    }
  }

  if (sims.length === 0) {
    // No simulators, but a real device / Android is around → the helpful explanation.
    if (all.some(d => d.kind === 'physical' || d.platform === 'android')) {
      explainSimulatorOnly();
    } else {
      console.error(chalk.red('No iOS simulators running.'));
      console.error(chalk.gray('Boot one with `simon launch -i`.'));
    }
    process.exit(1);
  }

  let device: IosSimulator;
  if (name) {
    const found = sims.find(d => d.name === name || d.udid === name);
    if (!found) {
      console.error(chalk.red(`iOS simulator "${name}" not found or not running.`));
      process.exit(1);
    }
    device = found;
  } else if (sims.length === 1) {
    device = sims[0];
  } else {
    device = await selectWithExit('Select a simulator to push to:', sims.map(d => ({ name: deviceLabel(d), value: d })));
  }

  try {
    const bundle = options.bundleId ? `"${options.bundleId}" ` : '';
    execSync(`xcrun simctl push "${device.udid}" ${bundle}"${payload}"`, { stdio: 'inherit' });
    console.log(chalk.green(`Pushed to ${device.name}.`));
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    console.error(
      chalk.gray('If the payload has no "Simulator Target Bundle" key, pass the app with -b <bundle-id>.'),
    );
    process.exit(1);
  }
}
