import select from '@inquirer/select';
import chalk from 'chalk';
import { launchAvd, listAvds } from '../utils/android.js';
import { bootSimulator, listSimulators } from '../utils/ios.js';
import { loadPrefs } from '../utils/prefs.js';

interface LaunchOptions {
  ios?: string | boolean;
  android?: string | boolean;
}

export async function launchCommand(options: LaunchOptions): Promise<void> {
  if (options.ios === undefined && options.android === undefined) {
    console.error(chalk.red('Specify --ios (-i) or --android (-a)'));
    process.exit(1);
  }

  if (options.ios !== undefined) await launchIos(options.ios);
  if (options.android !== undefined) await launchAndroid(options.android);
}

async function launchIos(arg: string | boolean): Promise<void> {
  const sims = listSimulators();
  if (sims.length === 0) {
    console.error(chalk.red('No iOS simulators found. Install one via Xcode → Settings → Platforms.'));
    process.exit(1);
  }

  if (typeof arg === 'string') {
    const sim = sims.find(s => s.name === arg || s.udid === arg);
    if (!sim) {
      console.error(chalk.red(`Simulator "${arg}" not found.`));
      console.error(chalk.gray('Run `simon list ios` to see available simulators.'));
      process.exit(1);
    }
    console.log(chalk.cyan(`Launching ${sim.name}...`));
    bootSimulator(sim.udid);
    return;
  }

  // no name — check preferred first
  const prefs = loadPrefs();
  if (prefs.ios) {
    const preferred = sims.find(s => s.udid === prefs.ios);
    if (preferred) {
      console.log(chalk.cyan(`Launching preferred: ${preferred.name}...`));
      bootSimulator(preferred.udid);
      return;
    }
  }

  const sim = await select({
    message: 'Select an iOS simulator:',
    choices: sims.map(s => ({
      name: `${s.name}  ${chalk.gray(s.runtime)}${s.state === 'Booted' ? chalk.green('  ● running') : ''}`,
      value: s,
    })),
  });

  console.log(chalk.cyan(`Launching ${sim.name}...`));
  bootSimulator(sim.udid);
}

async function launchAndroid(arg: string | boolean): Promise<void> {
  const avds = listAvds();
  if (avds.length === 0) {
    console.error(chalk.red('No Android emulators found. Create one via Android Studio → Device Manager.'));
    process.exit(1);
  }

  if (typeof arg === 'string') {
    if (!avds.includes(arg)) {
      console.error(chalk.red(`Emulator "${arg}" not found.`));
      console.error(chalk.gray('Run `simon list android` to see available emulators.'));
      process.exit(1);
    }
    console.log(chalk.cyan(`Launching ${arg}...`));
    launchAvd(arg);
    return;
  }

  // no name — check preferred first
  const prefs = loadPrefs();
  if (prefs.android && avds.includes(prefs.android)) {
    console.log(chalk.cyan(`Launching preferred: ${prefs.android}...`));
    launchAvd(prefs.android);
    return;
  }

  const name = await select({
    message: 'Select an Android emulator:',
    choices: avds.map(a => ({ name: a, value: a })),
  });

  console.log(chalk.cyan(`Launching ${name}...`));
  launchAvd(name);
}
