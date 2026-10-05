import chalk from 'chalk';
import { spinner } from '../utils/prompt.js';
import {
  compareVersions,
  currentVersion,
  downloadBinary,
  installBinary,
  latestRelease,
} from '../utils/update.js';

export async function updateCommand(): Promise<void> {
  const current = currentVersion();

  const stop = spinner('Checking for updates...');
  let latest;
  try {
    latest = await latestRelease();
    stop();
  } catch (err) {
    stop();
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  if (current !== 'unknown' && compareVersions(latest.version, current) <= 0) {
    console.log(chalk.green(`Already on the latest version (${current}).`));
    return;
  }

  console.log(`Updating ${chalk.gray(current)} → ${chalk.green(latest.version)}...`);

  const stopDl = spinner('Downloading...');
  let tmp: string;
  try {
    tmp = await downloadBinary(latest.tag);
    stopDl();
  } catch (err) {
    stopDl();
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  console.log(chalk.gray('Installing to /usr/local/bin (may prompt for your password)...'));
  try {
    installBinary(tmp);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  console.log(chalk.green(`Updated to ${latest.version}.`));
}
