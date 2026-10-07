import chalk from 'chalk';
import { spinner } from '../utils/prompt.js';
import {
  Channel,
  changelogSince,
  compareVersions,
  currentVersion,
  latestForChannel,
  loadChannel,
  platformSupported,
} from '../utils/update.js';

interface CheckUpdateOptions {
  nightly?: boolean;
  stable?: boolean;
  dev?: boolean;
}

export async function checkUpdateCommand(options: CheckUpdateOptions): Promise<void> {
  if (!platformSupported()) {
    console.error(chalk.yellow('simon self-update is macOS-only (arm64/x64). Build from source on other platforms.'));
    process.exit(1);
  }
  const channel: Channel = options.dev
    ? 'dev'
    : options.nightly
    ? 'nightly'
    : options.stable
    ? 'stable'
    : loadChannel();
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

  const cmp = current === 'unknown' ? 1 : compareVersions(latest.version, current);
  console.log(`Channel:   ${chalk.cyan(channel)}`);
  console.log(`Installed: ${chalk.gray(current)}`);
  console.log(`Latest:    ${cmp > 0 ? chalk.green(latest.version) : chalk.gray(latest.version)}`);

  if (cmp === 0) {
    console.log(chalk.green("\nYou're up to date."));
    return;
  }
  if (cmp < 0) {
    console.log(chalk.yellow(`\nThe latest ${channel} build (${latest.version}) is older than your installed version.`));
    if (options.nightly || options.stable) {
      const flag = options.dev ? ' --dev' : options.nightly ? ' --nightly' : ' --stable';
      console.log(chalk.gray(`Run \`simon update${flag}\` to switch to the ${channel} channel (installs ${latest.version}).`));
    }
    return;
  }

  const notes = await changelogSince(channel, current);
  if (notes) {
    console.log(chalk.bold(`\nWhat's new (${current} → ${latest.version}):`));
    console.log(chalk.gray(notes));
  }
  const flag = options.dev ? ' --dev' : options.nightly ? ' --nightly' : options.stable ? ' --stable' : '';
  console.log(chalk.gray(`\nRun \`simon update${flag}\` to install.`));
}
