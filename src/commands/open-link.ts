import chalk from 'chalk';
import { openUrlOnEmulator, openUrlOnPhysicalAndroid } from '../utils/android.js';
import { openUrlOnPhysicalIos, openUrlOnSimulator } from '../utils/ios.js';
import { RunningDevice, pickRunningDevice, resolveFilterName } from '../utils/devices.js';

interface OpenLinkOptions {
  ios?: string | boolean;
  android?: string | boolean;
  bundleId?: string;
  restart?: boolean;
}

export async function openLinkCommand(url: string, target: string | undefined, options: OpenLinkOptions): Promise<void> {
  try {
    const { filter, name } = resolveFilterName(options, target);

    const device = await pickRunningDevice('Select a device to open the link on:', filter, name);
    openOnDevice(device, url, options.bundleId, options.restart);
    console.log(chalk.green(`Opened on ${device.name}`));
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

function openOnDevice(device: RunningDevice, url: string, bundleId?: string, restart?: boolean): void {
  if (device.platform === 'ios') {
    if (device.kind === 'simulator') openUrlOnSimulator(device.udid, url);
    else openUrlOnPhysicalIos(device.udid, url, bundleId, restart);
  } else {
    if (device.kind === 'emulator') openUrlOnEmulator(device.serial, url);
    else openUrlOnPhysicalAndroid(device.serial, url);
  }
}
