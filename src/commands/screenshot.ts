import chalk from 'chalk';
import { homedir } from 'os';
import path from 'path';
import { takeScreenshot as androidScreenshot } from '../utils/android.js';
import { takeScreenshot as iosScreenshot } from '../utils/ios.js';
import { RunningDevice, pickRunningDevice } from '../utils/devices.js';

interface ScreenshotOptions {
  ios?: string | boolean;
  android?: string | boolean;
  output?: string;
}

function defaultPath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(homedir(), 'Desktop', `simon_screenshot_${ts}.png`);
}

export async function screenshotCommand(options: ScreenshotOptions): Promise<void> {
  const filter = options.ios !== undefined ? 'ios' : options.android !== undefined ? 'android' : undefined;
  const name = typeof options.ios === 'string' ? options.ios
    : typeof options.android === 'string' ? options.android
    : undefined;

  const device = await pickRunningDevice('Select a device to screenshot:', filter, name);
  const outputPath = options.output ?? defaultPath();

  takeScreenshot(device, outputPath);
  console.log(chalk.green(`Saved to ${outputPath}`));
}

function takeScreenshot(device: RunningDevice, outputPath: string): void {
  if (device.platform === 'ios') {
    if (device.kind === 'physical') {
      console.error(chalk.red('Screenshots are not supported on physical iOS devices.'));
      process.exit(1);
    }
    iosScreenshot(device.udid, outputPath);
  } else {
    androidScreenshot(device.serial, outputPath);
  }
}
