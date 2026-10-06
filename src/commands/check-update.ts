import chalk from 'chalk';
import { spinner } from '../utils/prompt.js';
import {
  Channel,
  changelogSince,
  currentVersion,
  latestForChannel,
  loadChannel,
  platformSupported,
} from '../utils/update.js';

interface CheckUpdateOptions {
  nightly?: boolean;
  stable?: boolean;
}

export async function checkUpdateCommand(options: CheckUpdateOptions): Promise<void> {
  if (!platformSupported()) {
    console.error(chalk.yellow('simon self-update is macOS-only (arm64/x64). Build from source on other platforms.'));
    process.exit(1);
  }
  const channel: Channel = options.nightly ? 'nightly' : options.stable ? 'stable' : loadChannel();
  const current = currentVersion();

  const stop = spinner(`Checking for ${channel} updates...`);
  let latest;
  try {
    latest = await latestForChannel(channel);
    stop();
  } catch (err) {
    stop();
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const upToDate = current !== 'unknown' && current === latest.version;
  console.log(`Channel:   ${chalk.cyan(channel)}`);
  console.log(`Installed: ${chalk.gray(current)}`);
  console.log(`Latest:    ${upToDate ? chalk.gray(latest.version) : chalk.green(latest.version)}`);

  if (upToDate) {
    console.log(chalk.green("\nYou're up to date."));
    return;
  }

  const notes = await changelogSince(channel, current);
  if (notes) {
    console.log(chalk.bold(`\nWhat's new (${current} → ${latest.version}):`));
    console.log(chalk.gray(notes));
  }
  const flag = options.nightly ? ' --nightly' : options.stable ? ' --stable' : '';
  console.log(chalk.gray(`\nRun \`simon update${flag}\` to install.`));
}
