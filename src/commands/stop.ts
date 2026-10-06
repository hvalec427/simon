import chalk from 'chalk';
import { stopEmulator } from '../utils/android.js';
import { shutdownSimulator } from '../utils/ios.js';
import { pickRunningDevice, resolveFilterName } from '../utils/devices.js';

interface StopOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function stopCommand(target: string | undefined, options: StopOptions): Promise<void> {
  const { filter, name } = resolveFilterName(options, target);

  // Physical devices can't be stopped, so they're excluded from the picker.
  const device = await pickRunningDevice('Select a device to stop:', filter, name, true);

  console.log(chalk.cyan(`Stopping ${device.name}...`));
  if (device.platform === 'ios') shutdownSimulator(device.udid);
  else stopEmulator(device.serial);
  console.log(chalk.green('Done.'));
}
