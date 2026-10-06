import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { RunningDevice, deviceLabel, getAllRunningDevices } from '../utils/devices.js';
import { selectWithExit, spinner } from '../utils/prompt.js';
import { loadPushConfig, pushConfigPath, resolveTransport } from '../utils/pushconfig.js';
import { sendFcm } from '../utils/fcm.js';
import { sendApns } from '../utils/apns.js';

interface PushOptions {
  ios?: string | boolean;
  bundleId?: string;
  template?: boolean;
  token?: string;
  fcm?: boolean;
  apns?: boolean;
}

type IosSimulator = Extract<RunningDevice, { platform: 'ios'; kind: 'simulator' }>;

// aps-shaped payload: used by the simulator (simctl) and direct APNs.
const APS_TEMPLATE = {
  aps: {
    alert: { title: 'Notification title', body: 'Notification body' },
    sound: 'default',
    badge: 1,
  },
  custom_data_1: 'value1',
  custom_data_2: 'value2',
};

// FCM v1 message body (simon injects the token).
const FCM_TEMPLATE = {
  notification: { title: 'Notification title', body: 'Notification body' },
  data: { custom_data_1: 'value1', custom_data_2: 'value2' },
  apns: { payload: { aps: { sound: 'default', badge: 1 } } },
};

function explainSimulatorOnly(): void {
  console.error(chalk.red('Push notifications can only be sent to an iOS simulator.'));
}

function printTemplate(options: PushOptions): void {
  console.log(JSON.stringify(options.fcm ? FCM_TEMPLATE : APS_TEMPLATE, null, 2));
  if (process.stdout.isTTY) {
    console.error(
      chalk.gray(
        options.fcm
          ? '\nSave to a file, then: simon push <file> --token <token> --fcm'
          : '\nSave to a file, then: simon push <file> -b <bundle-id>  (or --token <token> for a real device)',
      ),
    );
  }
}

async function sendToToken(payload: string, options: PushOptions): Promise<void> {
  const cfg = loadPushConfig();
  if (!cfg) {
    console.error(chalk.red(`No push config found at ${pushConfigPath()}.`));
    console.error(chalk.gray('Create it from a template in the README (FCM or APNs).'));
    process.exit(1);
  }

  let transport;
  try {
    transport = resolveTransport(cfg, options.fcm ? 'fcm' : options.apns ? 'apns' : undefined);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  let body: object;
  try {
    body = JSON.parse(readFileSync(payload, 'utf8'));
  } catch {
    console.error(chalk.red(`Could not parse ${payload} as JSON.`));
    process.exit(1);
  }

  const stop = spinner(`Sending via ${transport.toUpperCase()}...`);
  try {
    if (transport === 'fcm') await sendFcm(cfg.fcm!.serviceAccount, options.token!, body);
    else await sendApns(cfg.apns!, options.token!, body);
    stop();
    console.log(chalk.green(`Push sent via ${transport.toUpperCase()}.`));
  } catch (err) {
    stop();
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

async function sendToSimulator(payload: string, options: PushOptions): Promise<void> {
  const name = typeof options.ios === 'string' ? options.ios : undefined;

  const stop = spinner('Loading devices...');
  const all = await getAllRunningDevices();
  stop();

  const sims = all.filter((d): d is IosSimulator => d.platform === 'ios' && d.kind === 'simulator');

  // Aiming at a named real/Android device → explain, don't fail cryptically.
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
    console.error(chalk.gray('If the payload has no "Simulator Target Bundle" key, pass the app with -b <bundle-id>.'));
    process.exit(1);
  }
}

export async function pushCommand(payload: string | undefined, options: PushOptions): Promise<void> {
  if (options.template) {
    printTemplate(options);
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

  if (options.token) await sendToToken(payload, options);
  else await sendToSimulator(payload, options);
}
