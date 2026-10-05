import chalk from 'chalk';
import { launchAvd } from '../utils/android.js';
import { bootSimulator } from '../utils/ios.js';
import { pickInstalledDevice } from '../utils/devices.js';

interface LaunchOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function launchCommand(options: LaunchOptions): Promise<void> {
  const filter = options.ios !== undefined ? 'ios' : options.android !== undefined ? 'android' : undefined;
  const name = typeof options.ios === 'string' ? options.ios
    : typeof options.android === 'string' ? options.android
    : undefined;

  const device = await pickInstalledDevice('Select a device to launch:', { filter, name });

  console.log(chalk.cyan(`Launching ${device.name}...`));
  if (device.platform === 'ios') bootSimulator(device.udid);
  else launchAvd(device.name);
}
