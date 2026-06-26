import chalk from 'chalk';
import { connectedAndroidDevices, runningEmulators } from '../utils/android.js';
import { listPhysicalIosDevices, runningSimulators } from '../utils/ios.js';

export function runningCommand(): void {
  const iosSims = runningSimulators();
  const iosPhysical = listPhysicalIosDevices();
  const androidEmus = runningEmulators();
  const androidPhysical = connectedAndroidDevices();

  console.log(chalk.bold.blue('\niOS Simulators (running)'));
  console.log(chalk.gray('─'.repeat(50)));
  if (iosSims.length === 0) {
    console.log(chalk.gray('  None'));
  } else {
    for (const sim of iosSims) {
      console.log(`  ${chalk.green('●')}  ${sim.name}  ${chalk.gray(sim.runtime)}`);
    }
  }

  console.log(chalk.bold.blue('\niOS Physical Devices (connected)'));
  console.log(chalk.gray('─'.repeat(50)));
  if (iosPhysical.length === 0) {
    console.log(chalk.gray('  None'));
  } else {
    for (const d of iosPhysical) {
      console.log(`  ${chalk.green('●')}  ${d.name}  ${chalk.gray(`iOS ${d.osVersion}`)}`);
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

  console.log(chalk.bold.blue('\nAndroid Physical Devices (connected)'));
  console.log(chalk.gray('─'.repeat(50)));
  if (androidPhysical.length === 0) {
    console.log(chalk.gray('  None'));
  } else {
    for (const d of androidPhysical) {
      console.log(`  ${chalk.green('●')}  ${d.name}  ${chalk.gray(d.serial)}`);
    }
  }

  console.log();
}
