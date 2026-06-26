import chalk from 'chalk';
import { runningEmulators } from '../utils/android.js';
import { runningSimulators } from '../utils/ios.js';

export function runningCommand(): void {
  const iosSims = runningSimulators();
  const androidEmus = runningEmulators();

  console.log(chalk.bold.blue('\niOS Simulators (running)'));
  console.log(chalk.gray('─'.repeat(50)));
  if (iosSims.length === 0) {
    console.log(chalk.gray('  None'));
  } else {
    for (const sim of iosSims) {
      console.log(`  ${chalk.green('●')}  ${sim.name}  ${chalk.gray(sim.runtime)}`);
    }
  }

  console.log(chalk.bold.blue('\nAndroid Emulators (running)'));
  console.log(chalk.gray('─'.repeat(50)));
  if (androidEmus.length === 0) {
    console.log(chalk.gray('  None'));
  } else {
    for (const emu of androidEmus) {
      console.log(`  ${chalk.green('●')}  ${emu.name}  ${chalk.gray(emu.serial)}`);
    }
  }

  console.log();
}
