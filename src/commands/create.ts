import input from '@inquirer/input';
import chalk from 'chalk';
import {
  createAvd,
  listDeviceDefinitions,
  listInstalledSystemImages,
} from '../utils/android.js';
import { createSimulator, listDeviceTypes, listRuntimes } from '../utils/ios.js';
import { selectWithExit } from '../utils/prompt.js';

interface CreateOptions {
  ios?: boolean;
  android?: boolean;
}

export async function createCommand(options: CreateOptions): Promise<void> {
  if (!options.ios && !options.android) {
    console.error(chalk.red('Specify --ios (-i) or --android (-a)'));
    process.exit(1);
  }

  if (options.ios) await createIos();
  if (options.android) await createAndroid();
}

async function createIos(): Promise<void> {
  const deviceTypes = listDeviceTypes();
  if (deviceTypes.length === 0) {
    console.error(chalk.red('No device types found. Make sure Xcode is installed.'));
    process.exit(1);
  }

  const runtimes = listRuntimes();
  if (runtimes.length === 0) {
    console.error(chalk.red('No iOS runtimes found. Install one via Xcode → Settings → Platforms.'));
    process.exit(1);
  }

  const deviceType = await selectWithExit('Select device:', deviceTypes.map(d => ({ name: d.name, value: d })));
  const runtime = await selectWithExit('Select iOS version:', runtimes.map(r => ({ name: r.name, value: r })));

  const name = await input({
    message: 'Simulator name:',
    default: `${deviceType.name} (${runtime.version})`,
  });

  console.log(chalk.cyan(`\nCreating "${name}"...`));
  try {
    const udid = createSimulator(name, deviceType.identifier, runtime.identifier);
    console.log(chalk.green(`Done — ${name}`));
    console.log(chalk.gray(`UDID: ${udid}`));
  } catch (e) {
    console.error(chalk.red('Failed to create simulator.'));
    console.error(chalk.gray(String(e)));
    process.exit(1);
  }
}

async function createAndroid(): Promise<void> {
  const devices = listDeviceDefinitions();
  if (devices.length === 0) {
    console.error(chalk.red('No device definitions found. Make sure Android SDK cmdline-tools are installed.'));
    process.exit(1);
  }

  const images = listInstalledSystemImages();
  if (images.length === 0) {
    console.error(chalk.red('No system images found. Install one via Android Studio → SDK Manager.'));
    process.exit(1);
  }

  const device = await selectWithExit('Select device:', devices.map(d => ({ name: d.name, value: d })));
  const image = await selectWithExit('Select Android version:', images.map(i => ({ name: i.label, value: i })));

  const name = await input({
    message: 'Emulator name:',
    default: `${device.name} API ${image.api}`,
    validate: v => (v.includes(' ') ? 'AVD names cannot contain spaces' : true),
  });

  console.log(chalk.cyan(`\nCreating "${name}"...`));
  try {
    createAvd(name, device.id, image.package);
    console.log(chalk.green(`Done — ${name}`));
  } catch (e) {
    console.error(chalk.red('Failed to create emulator.'));
    console.error(chalk.gray(String(e)));
    process.exit(1);
  }
}
