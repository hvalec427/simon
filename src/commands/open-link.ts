import chalk from 'chalk';
import {
  connectedAndroidDevices,
  openUrlOnEmulator,
  openUrlOnPhysicalAndroid,
  runningEmulators,
} from '../utils/android.js';
import {
  listPhysicalIosDevices,
  openUrlOnPhysicalIos,
  openUrlOnSimulator,
  runningSimulators,
} from '../utils/ios.js';
import { selectWithExit } from '../utils/prompt.js';

interface OpenLinkOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

type RunningDevice =
  | { platform: 'ios'; kind: 'simulator'; name: string; udid: string; runtime: string }
  | { platform: 'ios'; kind: 'physical'; name: string; udid: string; osVersion: string }
  | { platform: 'android'; kind: 'emulator'; name: string; serial: string }
  | { platform: 'android'; kind: 'physical'; name: string; serial: string };

export async function openLinkCommand(url: string, options: OpenLinkOptions): Promise<void> {
  if (options.ios !== undefined) {
    await openOnIos(url, options.ios);
  } else if (options.android !== undefined) {
    await openOnAndroid(url, options.android);
  } else {
    await openOnAny(url);
  }
}

function openOnDevice(device: RunningDevice, url: string): void {
  if (device.platform === 'ios') {
    if (device.kind === 'simulator') openUrlOnSimulator(device.udid, url);
    else openUrlOnPhysicalIos(device.udid, url);
  } else {
    if (device.kind === 'emulator') openUrlOnEmulator(device.serial, url);
    else openUrlOnPhysicalAndroid(device.serial, url);
  }
}

async function openOnIos(url: string, arg: string | boolean): Promise<void> {
  const simulators = runningSimulators();
  const physical = listPhysicalIosDevices();

  const devices: RunningDevice[] = [
    ...simulators.map(s => ({ platform: 'ios' as const, kind: 'simulator' as const, name: s.name, udid: s.udid, runtime: s.runtime })),
    ...physical.map(d => ({ platform: 'ios' as const, kind: 'physical' as const, name: d.name, udid: d.udid, osVersion: d.osVersion })),
  ];

  if (devices.length === 0) {
    console.error(chalk.red('No iOS simulators running or physical devices connected.'));
    process.exit(1);
  }

  if (typeof arg === 'string') {
    const device = devices.find(d => d.name === arg || ('udid' in d && d.udid === arg));
    if (!device) {
      console.error(chalk.red(`iOS device "${arg}" not found or not connected.`));
      process.exit(1);
    }
    openOnDevice(device, url);
    console.log(chalk.green(`Opened on ${device.name}`));
    return;
  }

  if (devices.length === 1) {
    openOnDevice(devices[0], url);
    console.log(chalk.green(`Opened on ${devices[0].name}`));
    return;
  }

  const device = await selectWithExit('Select an iOS device:', devices.map(d => ({
    name: d.kind === 'simulator'
      ? `${d.name}  ${chalk.gray((d as any).runtime + '  · simulator')}`
      : `${d.name}  ${chalk.gray(`iOS ${(d as any).osVersion}  · physical`)}`,
    value: d,
  })));

  openOnDevice(device, url);
  console.log(chalk.green(`Opened on ${device.name}`));
}

async function openOnAndroid(url: string, arg: string | boolean): Promise<void> {
  const emulators = runningEmulators();
  const physical = connectedAndroidDevices();

  const devices: RunningDevice[] = [
    ...emulators.map(e => ({ platform: 'android' as const, kind: 'emulator' as const, name: e.name, serial: e.serial })),
    ...physical.map(d => ({ platform: 'android' as const, kind: 'physical' as const, name: d.name, serial: d.serial })),
  ];

  if (devices.length === 0) {
    console.error(chalk.red('No Android emulators running or physical devices connected.'));
    process.exit(1);
  }

  if (typeof arg === 'string') {
    const device = devices.find(d => d.name === arg || (d as any).serial === arg);
    if (!device) {
      console.error(chalk.red(`Android device "${arg}" not found or not connected.`));
      process.exit(1);
    }
    openOnDevice(device, url);
    console.log(chalk.green(`Opened on ${device.name}`));
    return;
  }

  if (devices.length === 1) {
    openOnDevice(devices[0], url);
    console.log(chalk.green(`Opened on ${devices[0].name}`));
    return;
  }

  const device = await selectWithExit('Select an Android device:', devices.map(d => ({
    name: `${d.name}  ${chalk.gray(d.kind === 'emulator' ? 'emulator' : 'physical')}`,
    value: d,
  })));

  openOnDevice(device, url);
  console.log(chalk.green(`Opened on ${device.name}`));
}

async function openOnAny(url: string): Promise<void> {
  const allDevices: { name: string; value: RunningDevice }[] = [
    ...runningSimulators().map(s => ({
      name: `${s.name}  ${chalk.gray(s.runtime + '  · iOS simulator')}`,
      value: { platform: 'ios' as const, kind: 'simulator' as const, name: s.name, udid: s.udid, runtime: s.runtime },
    })),
    ...listPhysicalIosDevices().map(d => ({
      name: `${d.name}  ${chalk.gray(`iOS ${d.osVersion}  · physical`)}`,
      value: { platform: 'ios' as const, kind: 'physical' as const, name: d.name, udid: d.udid, osVersion: d.osVersion },
    })),
    ...runningEmulators().map(e => ({
      name: `${e.name}  ${chalk.gray('Android  · emulator')}`,
      value: { platform: 'android' as const, kind: 'emulator' as const, name: e.name, serial: e.serial },
    })),
    ...connectedAndroidDevices().map(d => ({
      name: `${d.name}  ${chalk.gray('Android  · physical')}`,
      value: { platform: 'android' as const, kind: 'physical' as const, name: d.name, serial: d.serial },
    })),
  ];

  if (allDevices.length === 0) {
    console.error(chalk.red('No simulators, emulators, or physical devices available.'));
    process.exit(1);
  }

  if (allDevices.length === 1) {
    const d = allDevices[0].value;
    openOnDevice(d, url);
    console.log(chalk.green(`Opened on ${d.name}`));
    return;
  }

  const device = await selectWithExit('Select a device:', allDevices);
  openOnDevice(device, url);
  console.log(chalk.green(`Opened on ${device.name}`));
}
