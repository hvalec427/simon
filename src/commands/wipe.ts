import confirm from '@inquirer/confirm';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { wipeAvd } from '../utils/android.js';
import { pickInstalledDevice, resolveFilterName } from '../utils/devices.js';

interface WipeOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function wipeCommand(target: string | undefined, options: WipeOptions): Promise<void> {
  const { filter, name } = resolveFilterName(options, target);

  // Running devices can't be wiped, so they're hidden from the picker; a device
  // named explicitly is still found (and guarded below) so the error is clear.
  const device = await pickInstalledDevice('Select a device to wipe:', { filter, name, excludeRunning: true });

  if (device.running) {
    console.error(chalk.red(`Cannot wipe "${device.name}" while it is running. Stop it first.`));
    process.exit(1);
  }

  const ok = await confirm({
    message: `Wipe all data on ${chalk.bold(device.name)}? This cannot be undone.`,
    default: false,
  });
  if (!ok) return;

  try {
    if (device.platform === 'ios') execSync(`xcrun simctl erase "${device.udid}"`);
    else wipeAvd(device.name);
    console.log(chalk.green(`Wiped ${device.name}.`));
  } catch (e) {
    console.error(chalk.red('Wipe failed.'), String(e));
    process.exit(1);
  }
}
