import chalk from 'chalk';
import { openUrlOnEmulator, openUrlOnPhysicalAndroid } from '../utils/android.js';
import { openUrlOnPhysicalIos, openUrlOnSimulator } from '../utils/ios.js';
import { RunningDevice, pickRunningDevice } from '../utils/devices.js';

interface OpenLinkOptions {
  ios?: string | boolean;
  android?: string | boolean;
  bundleId?: string;
}

export async function openLinkCommand(url: string, options: OpenLinkOptions): Promise<void> {
  try {
    const filter = options.ios !== undefined ? 'ios' : options.android !== undefined ? 'android' : undefined;
    const name = typeof options.ios === 'string' ? options.ios
      : typeof options.android === 'string' ? options.android
      : undefined;

    const device = await pickRunningDevice('Select a device to open the link on:', filter, name);
    openOnDevice(device, url, options.bundleId);
    console.log(chalk.green(`Opened on ${device.name}`));
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

function openOnDevice(device: RunningDevice, url: string, bundleId?: string): void {
  if (device.platform === 'ios') {
    if (device.kind === 'simulator') openUrlOnSimulator(device.udid, url);
    else openUrlOnPhysicalIos(device.udid, url, bundleId);
  } else {
    if (device.kind === 'emulator') openUrlOnEmulator(device.serial, url);
    else openUrlOnPhysicalAndroid(device.serial, url);
  }
}
