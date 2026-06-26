import chalk from 'chalk';
import { openUrlOnEmulator, runningEmulators } from '../utils/android.js';
import { openUrlOnSimulator, runningSimulators } from '../utils/ios.js';
import { selectWithExit } from '../utils/prompt.js';

interface OpenLinkOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

type RunningDevice =
  | { platform: 'ios'; name: string; udid: string; runtime: string }
  | { platform: 'android'; name: string; serial: string };

export async function openLinkCommand(url: string, options: OpenLinkOptions): Promise<void> {
  if (options.ios !== undefined) {
    await openOnIos(url, options.ios);
  } else if (options.android !== undefined) {
    await openOnAndroid(url, options.android);
  } else {
    await openOnAny(url);
  }
}

async function openOnIos(url: string, arg: string | boolean): Promise<void> {
  const running = runningSimulators();
  if (running.length === 0) {
    console.error(chalk.red('No iOS simulators are running.'));
    process.exit(1);
  }

  if (typeof arg === 'string') {
    const sim = running.find(s => s.name === arg || s.udid === arg);
    if (!sim) {
      console.error(chalk.red(`Running simulator "${arg}" not found.`));
      process.exit(1);
    }
    openUrlOnSimulator(sim.udid, url);
    console.log(chalk.green(`Opened on ${sim.name}`));
    return;
  }

  if (running.length === 1) {
    openUrlOnSimulator(running[0].udid, url);
    console.log(chalk.green(`Opened on ${running[0].name}`));
    return;
  }

  const sim = await selectWithExit('Select an iOS simulator:', running.map(s => ({
    name: `${s.name}  ${chalk.gray(s.runtime)}`,
    value: s,
  })));
  openUrlOnSimulator(sim.udid, url);
  console.log(chalk.green(`Opened on ${sim.name}`));
}

async function openOnAndroid(url: string, arg: string | boolean): Promise<void> {
  const running = runningEmulators();
  if (running.length === 0) {
    console.error(chalk.red('No Android emulators are running.'));
    process.exit(1);
  }

  if (typeof arg === 'string') {
    const emu = running.find(e => e.name === arg || e.serial === arg);
    if (!emu) {
      console.error(chalk.red(`Running emulator "${arg}" not found.`));
      process.exit(1);
    }
    openUrlOnEmulator(emu.serial, url);
    console.log(chalk.green(`Opened on ${emu.name}`));
    return;
  }

  if (running.length === 1) {
    openUrlOnEmulator(running[0].serial, url);
    console.log(chalk.green(`Opened on ${running[0].name}`));
    return;
  }

  const emu = await selectWithExit('Select an Android emulator:', running.map(e => ({
    name: e.name,
    value: e,
  })));
  openUrlOnEmulator(emu.serial, url);
  console.log(chalk.green(`Opened on ${emu.name}`));
}

async function openOnAny(url: string): Promise<void> {
  const iosSims = runningSimulators();
  const androidEmus = runningEmulators();

  const devices: { name: string; value: RunningDevice }[] = [
    ...iosSims.map(s => ({
      name: `${s.name}  ${chalk.gray(s.runtime + '  · iOS')}`,
      value: { platform: 'ios' as const, name: s.name, udid: s.udid, runtime: s.runtime },
    })),
    ...androidEmus.map(e => ({
      name: `${e.name}  ${chalk.gray('Android')}`,
      value: { platform: 'android' as const, name: e.name, serial: e.serial },
    })),
  ];

  if (devices.length === 0) {
    console.error(chalk.red('No simulators or emulators are running.'));
    process.exit(1);
  }

  if (devices.length === 1) {
    const d = devices[0].value;
    if (d.platform === 'ios') openUrlOnSimulator(d.udid, url);
    else openUrlOnEmulator(d.serial, url);
    console.log(chalk.green(`Opened on ${d.name}`));
    return;
  }

  const device = await selectWithExit('Select a device:', devices);

  if (device.platform === 'ios') {
    openUrlOnSimulator(device.udid, url);
  } else {
    openUrlOnEmulator(device.serial, url);
  }
  console.log(chalk.green(`Opened on ${device.name}`));
}
