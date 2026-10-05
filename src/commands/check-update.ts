import chalk from 'chalk';
import { spinner } from '../utils/prompt.js';
import { compareVersions, currentVersion, latestRelease } from '../utils/update.js';

export async function checkUpdateCommand(): Promise<void> {
  const current = currentVersion();
  const stop = spinner('Checking for updates...');
  try {
    const { version } = await latestRelease();
    stop();

    if (current === 'unknown') {
      console.log(`Latest version is ${chalk.cyan(version)}. ${chalk.gray('(current version unknown)')}`);
    } else if (compareVersions(version, current) > 0) {
      console.log(`Update available: ${chalk.gray(current)} → ${chalk.green(version)}`);
      console.log(chalk.gray('Run `simon update` to install it.'));
    } else {
      console.log(chalk.green(`You're on the latest version (${current}).`));
    }
  } catch (err) {
    stop();
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
