import confirm from '@inquirer/confirm';
import chalk from 'chalk';
import { listAvds, runningAvdNames, wipeAvd } from '../utils/android.js';
import { listSimulators, runningSimulators } from '../utils/ios.js';
import { selectWithExit } from '../utils/prompt.js';

interface WipeOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function wipeCommand(options: WipeOptions): Promise<void> {
  if (options.ios === undefined && options.android === undefined) {
    console.error(chalk.red('Specify --ios (-i) or --android (-a)'));
    process.exit(1);
  }

  if (options.ios !== undefined) await wipeIos(options.ios);
  if (options.android !== undefined) await wipeAndroid(options.android);
}

async function wipeIos(arg: string | boolean): Promise<void> {
  const all = listSimulators();
  const stoppedSims = all.filter(s => s.state !== 'Booted');

  if (all.length === 0) {
    console.log(chalk.gray('No iOS simulators found.'));
    return;
  }

  let sim: (typeof all)[0];

  if (typeof arg === 'string') {
    const found = all.find(s => s.name === arg || s.udid === arg);
    if (!found) { console.error(chalk.red(`Simulator "${arg}" not found.`)); process.exit(1); }
    sim = found;
  } else {
    if (stoppedSims.length === 0) {
      console.error(chalk.red('All simulators are running. Stop one first before wiping.'));
      process.exit(1);
    }
    sim = await selectWithExit('Select an iOS simulator to wipe:', stoppedSims.map(s => ({
      name: `${s.name}  ${chalk.gray(s.runtime)}`,
      value: s,
    })));
  }

  if (sim.state === 'Booted') {
    console.error(chalk.red(`Cannot wipe "${sim.name}" while it is running. Stop it first.`));
    process.exit(1);
  }

  const ok = await confirm({
    message: `Wipe all data on ${chalk.bold(sim.name)}? This cannot be undone.`,
    default: false,
  });
  if (!ok) return;

  try {
    const { execSync } = await import('child_process');
    execSync(`xcrun simctl erase "${sim.udid}"`);
    console.log(chalk.green(`Wiped ${sim.name}.`));
  } catch (e) {
    console.error(chalk.red('Wipe failed.'), String(e));
    process.exit(1);
  }
}

async function wipeAndroid(arg: string | boolean): Promise<void> {
  const avds = listAvds();
  const running = new Set(runningAvdNames());

  if (avds.length === 0) {
    console.log(chalk.gray('No Android emulators found.'));
    return;
  }

  const stoppedAvds = avds.filter(a => !running.has(a));
  let name: string;

  if (typeof arg === 'string') {
    if (!avds.includes(arg)) { console.error(chalk.red(`Emulator "${arg}" not found.`)); process.exit(1); }
    name = arg;
  } else {
    if (stoppedAvds.length === 0) {
      console.error(chalk.red('All emulators are running. Stop one first before wiping.'));
      process.exit(1);
    }
    name = await selectWithExit('Select an Android emulator to wipe:', stoppedAvds.map(a => ({
      name: a,
      value: a,
    })));
  }

  if (running.has(name)) {
    console.error(chalk.red(`Cannot wipe "${name}" while it is running. Stop it first.`));
    process.exit(1);
  }

  const ok = await confirm({
    message: `Wipe all data on ${chalk.bold(name)}? This cannot be undone.`,
    default: false,
  });
  if (!ok) return;

  try {
    wipeAvd(name);
    console.log(chalk.green(`Wiped ${name}.`));
  } catch (e) {
    console.error(chalk.red('Wipe failed.'), String(e));
    process.exit(1);
  }
}
