import chalk from 'chalk';
import { connectedAndroidDevices, listAvds, runningAvdNames } from '../utils/android.js';
import { listPhysicalIosDevices, listSimulators } from '../utils/ios.js';

interface ListOptions {
  ios?: boolean;
  android?: boolean;
}

export function listCommand(options: ListOptions): void {
  const showIos = !options.ios && !options.android ? true : !!options.ios;
  const showAndroid = !options.ios && !options.android ? true : !!options.android;

  if (showIos) {
    const sims = listSimulators();
    console.log(chalk.bold.blue('\niOS Simulators'));
    console.log(chalk.gray('─'.repeat(50)));
    if (sims.length === 0) {
      console.log(chalk.gray('  No simulators found'));
    } else {
      for (const sim of sims) {
        const dot = sim.state === 'Booted' ? chalk.green('●') : chalk.gray('○');
        const status = sim.state === 'Booted' ? chalk.green(' running') : '';
        console.log(`  ${dot}  ${sim.name}${status}  ${chalk.gray(sim.runtime)}`);
      }
    }

    const physical = listPhysicalIosDevices();
    console.log(chalk.bold.blue('\niOS Physical Devices'));
    console.log(chalk.gray('─'.repeat(50)));
    if (physical.length === 0) {
      console.log(chalk.gray('  No devices connected'));
    } else {
      for (const d of physical) {
        console.log(`  ${chalk.green('●')}  ${d.name}  ${chalk.gray(`iOS ${d.osVersion}`)}`);
      }
    }
  }

  if (showAndroid) {
    const avds = listAvds();
    const running = new Set(runningAvdNames());
    console.log(chalk.bold.blue('\nAndroid Emulators'));
    console.log(chalk.gray('─'.repeat(50)));
    if (avds.length === 0) {
      console.log(chalk.gray('  No emulators found'));
    } else {
      for (const avd of avds) {
        const isRunning = running.has(avd);
        const dot = isRunning ? chalk.green('●') : chalk.gray('○');
        const status = isRunning ? chalk.green(' running') : '';
        console.log(`  ${dot}  ${avd}${status}`);
      }
    }

    const physical = connectedAndroidDevices();
    console.log(chalk.bold.blue('\nAndroid Physical Devices'));
    console.log(chalk.gray('─'.repeat(50)));
    if (physical.length === 0) {
      console.log(chalk.gray('  No devices connected'));
    } else {
      for (const d of physical) {
        console.log(`  ${chalk.green('●')}  ${d.name}  ${chalk.gray(d.serial)}`);
      }
    }
  }

  console.log();
}
