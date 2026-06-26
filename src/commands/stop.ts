import select from '@inquirer/select';
import chalk from 'chalk';
import { runningEmulators, stopEmulator } from '../utils/android.js';
import { runningSimulators, shutdownSimulator } from '../utils/ios.js';

interface StopOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function stopCommand(options: StopOptions): Promise<void> {
  if (options.ios === undefined && options.android === undefined) {
    console.error(chalk.red('Specify --ios (-i) or --android (-a)'));
    process.exit(1);
  }

  if (options.ios !== undefined) await stopIos(options.ios);
  if (options.android !== undefined) await stopAndroid(options.android);
}

async function stopIos(arg: string | boolean): Promise<void> {
  const running = runningSimulators();
  if (running.length === 0) {
    console.log(chalk.gray('No iOS simulators are running.'));
    return;
  }

  if (typeof arg === 'string') {
    const sim = running.find(s => s.name === arg || s.udid === arg);
    if (!sim) {
      console.error(chalk.red(`Running simulator "${arg}" not found.`));
      console.error(chalk.gray('Run `simon running` to see what is running.'));
      process.exit(1);
    }
    console.log(chalk.cyan(`Stopping ${sim.name}...`));
    shutdownSimulator(sim.udid);
    console.log(chalk.green('Done.'));
    return;
  }

  const sim = await select({
    message: 'Select an iOS simulator to stop:',
    choices: running.map(s => ({
      name: `${s.name}  ${chalk.gray(s.runtime)}`,
      value: s,
    })),
  });

  console.log(chalk.cyan(`Stopping ${sim.name}...`));
  shutdownSimulator(sim.udid);
  console.log(chalk.green('Done.'));
}

async function stopAndroid(arg: string | boolean): Promise<void> {
  const running = runningEmulators();
  if (running.length === 0) {
    console.log(chalk.gray('No Android emulators are running.'));
    return;
  }

  if (typeof arg === 'string') {
    const emu = running.find(e => e.name === arg || e.serial === arg);
    if (!emu) {
      console.error(chalk.red(`Running emulator "${arg}" not found.`));
      console.error(chalk.gray('Run `simon running` to see what is running.'));
      process.exit(1);
    }
    console.log(chalk.cyan(`Stopping ${emu.name}...`));
    stopEmulator(emu.serial);
    console.log(chalk.green('Done.'));
    return;
  }

  const emu = await select({
    message: 'Select an Android emulator to stop:',
    choices: running.map(e => ({ name: e.name, value: e })),
  });

  console.log(chalk.cyan(`Stopping ${emu.name}...`));
  stopEmulator(emu.serial);
  console.log(chalk.green('Done.'));
}
