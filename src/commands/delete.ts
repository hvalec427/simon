import confirm from '@inquirer/confirm';
import chalk from 'chalk';
import { deleteAvd } from '../utils/android.js';
import { deleteSimulator } from '../utils/ios.js';
import { pickInstalledDevice, resolveFilterName } from '../utils/devices.js';

interface DeleteOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function deleteCommand(target: string | undefined, options: DeleteOptions): Promise<void> {
  const { filter, name } = resolveFilterName(options, target);

  const device = await pickInstalledDevice('Select a device to delete:', { filter, name });

  if (device.running) {
    console.error(chalk.red(`Cannot delete "${device.name}" while it is running. Stop it first.`));
    process.exit(1);
  }

  const ok = await confirm({ message: `Delete ${chalk.bold(device.name)}?`, default: false });
  if (!ok) return;

  if (device.platform === 'ios') deleteSimulator(device.udid);
  else deleteAvd(device.name);
  console.log(chalk.green(`Deleted ${device.name}.`));
}
