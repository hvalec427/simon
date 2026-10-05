import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { pickRunningDevice } from '../utils/devices.js';

interface PushOptions {
  ios?: string | boolean;
  bundleId?: string;
  template?: boolean;
}

// A production-shaped APNs payload: `aps` for the notification, plus custom
// data at the top level (where FCM delivers it on iOS). Edit and save to a file.
const TEMPLATE = {
  aps: {
    alert: { title: 'Order update', body: 'Your laundry is on the way 🚚' },
    sound: 'default',
    badge: 1,
  },
  order_uuid: 'REPLACE_ME',
  redirect: 'RC',
};

export async function pushCommand(payload: string | undefined, options: PushOptions): Promise<void> {
  if (options.template) {
    // Only the JSON goes to stdout, so `simon push --template > push.json` is clean.
    console.log(JSON.stringify(TEMPLATE, null, 2));
    console.error(chalk.gray('\nSave it to a file, then: simon push <file> -b <bundle-id>'));
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

  // simctl push only works on iOS simulators — physical devices are excluded.
  const device = await pickRunningDevice('Select a simulator to push to:', 'ios', name, true);
  if (device.kind !== 'simulator') {
    console.error(chalk.red('Push notifications are only supported on iOS simulators.'));
    process.exit(1);
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
