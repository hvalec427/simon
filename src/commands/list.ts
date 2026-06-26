import chalk from 'chalk';
import { listAvds, runningAvdNames } from '../utils/android.js';
import { listSimulators } from '../utils/ios.js';

export function listCommand(platform?: string): void {
  const showIos = !platform || platform === 'ios';
  const showAndroid = !platform || platform === 'android';

  if (platform && platform !== 'ios' && platform !== 'android') {
    console.error(chalk.red(`Unknown platform "${platform}". Use ios or android.`));
    process.exit(1);
  }

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
  }

  console.log();
}
