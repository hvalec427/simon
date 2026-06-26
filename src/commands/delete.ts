import confirm from '@inquirer/confirm';
import chalk from 'chalk';
import { deleteAvd, listAvds, runningAvdNames } from '../utils/android.js';
import { deleteSimulator, listSimulators } from '../utils/ios.js';
import { selectWithExit } from '../utils/prompt.js';

interface DeleteOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function deleteCommand(options: DeleteOptions): Promise<void> {
  if (options.ios === undefined && options.android === undefined) {
    console.error(chalk.red('Specify --ios (-i) or --android (-a)'));
    process.exit(1);
  }

  if (options.ios !== undefined) await deleteIos(options.ios);
  if (options.android !== undefined) await deleteAndroid(options.android);
}

async function deleteIos(arg: string | boolean): Promise<void> {
  const sims = listSimulators();
  if (sims.length === 0) {
    console.log(chalk.gray('No iOS simulators found.'));
    return;
  }

  let sim: (typeof sims)[0];

  if (typeof arg === 'string') {
    const found = sims.find(s => s.name === arg || s.udid === arg);
    if (!found) {
      console.error(chalk.red(`Simulator "${arg}" not found.`));
      process.exit(1);
    }
    sim = found;
  } else {
    sim = await selectWithExit('Select an iOS simulator to delete:', sims.map(s => ({
      name: `${s.name}  ${chalk.gray(s.runtime)}${s.state === 'Booted' ? chalk.red('  ● running') : ''}`,
      value: s,
    })));
  }

  if (sim.state === 'Booted') {
    console.error(chalk.red(`Cannot delete "${sim.name}" while it is running. Stop it first.`));
    process.exit(1);
  }

  const ok = await confirm({ message: `Delete ${chalk.bold(sim.name)}?`, default: false });
  if (!ok) return;

  deleteSimulator(sim.udid);
  console.log(chalk.green(`Deleted ${sim.name}.`));
}

async function deleteAndroid(arg: string | boolean): Promise<void> {
  const avds = listAvds();
  if (avds.length === 0) {
    console.log(chalk.gray('No Android emulators found.'));
    return;
  }

  const running = new Set(runningAvdNames());
  let name: string;

  if (typeof arg === 'string') {
    if (!avds.includes(arg)) {
      console.error(chalk.red(`Emulator "${arg}" not found.`));
      process.exit(1);
    }
    name = arg;
  } else {
    name = await selectWithExit('Select an Android emulator to delete:', avds.map(a => ({
      name: running.has(a) ? `${a}  ${chalk.red('● running')}` : a,
      value: a,
    })));
  }

  if (running.has(name)) {
    console.error(chalk.red(`Cannot delete "${name}" while it is running. Stop it first.`));
    process.exit(1);
  }

  const ok = await confirm({ message: `Delete ${chalk.bold(name)}?`, default: false });
  if (!ok) return;

  deleteAvd(name);
  console.log(chalk.green(`Deleted ${name}.`));
}
