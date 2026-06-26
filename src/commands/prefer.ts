import chalk from 'chalk';
import { listAvds } from '../utils/android.js';
import { listSimulators } from '../utils/ios.js';
import { loadPrefs, setAndroidPref, setIosPref } from '../utils/prefs.js';
import { selectWithExit } from '../utils/prompt.js';

interface PreferOptions {
  ios?: boolean;
  android?: boolean;
}

export async function preferCommand(options: PreferOptions): Promise<void> {
  if (!options.ios && !options.android) {
    showPrefs();
    return;
  }

  if (options.ios) await pickIos();
  if (options.android) await pickAndroid();
}

function showPrefs(): void {
  const prefs = loadPrefs();
  console.log(chalk.bold.blue('\nPreferred simulators/emulators'));
  console.log(chalk.gray('─'.repeat(50)));

  if (prefs.ios) {
    const sims = listSimulators();
    const sim = sims.find(s => s.udid === prefs.ios);
    const label = sim ? `${sim.name}  ${chalk.gray(sim.runtime)}` : chalk.gray(prefs.ios);
    console.log(`  iOS:     ${label}`);
  } else {
    console.log(`  iOS:     ${chalk.gray('not set')}`);
  }

  if (prefs.android) {
    console.log(`  Android: ${prefs.android}`);
  } else {
    console.log(`  Android: ${chalk.gray('not set')}`);
  }

  console.log();
}

async function pickIos(): Promise<void> {
  const sims = listSimulators();
  if (sims.length === 0) {
    console.error(chalk.red('No iOS simulators found.'));
    process.exit(1);
  }

  const sim = await selectWithExit('Select preferred iOS simulator:', sims.map(s => ({
    name: `${s.name}  ${chalk.gray(s.runtime)}`,
    value: s,
  })));

  setIosPref(sim.udid);
  console.log(chalk.green(`Preferred iOS simulator set to: ${sim.name}`));
}

async function pickAndroid(): Promise<void> {
  const avds = listAvds();
  if (avds.length === 0) {
    console.error(chalk.red('No Android emulators found.'));
    process.exit(1);
  }

  const name = await selectWithExit('Select preferred Android emulator:', avds.map(a => ({
    name: a,
    value: a,
  })));

  setAndroidPref(name);
  console.log(chalk.green(`Preferred Android emulator set to: ${name}`));
}
