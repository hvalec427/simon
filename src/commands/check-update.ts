import chalk from 'chalk';
import { spinner } from '../utils/prompt.js';
import { Channel, currentVersion, latestForChannel, loadChannel } from '../utils/update.js';

interface CheckUpdateOptions {
  nightly?: boolean;
  stable?: boolean;
}

export async function checkUpdateCommand(options: CheckUpdateOptions): Promise<void> {
  const channel: Channel = options.nightly ? 'nightly' : options.stable ? 'stable' : loadChannel();
  const current = currentVersion();

  const stop = spinner(`Checking for ${channel} updates...`);
  try {
    const { version } = await latestForChannel(channel);
    stop();

    if (current === 'unknown') {
      console.log(`Latest ${channel} version is ${chalk.cyan(version)}. ${chalk.gray('(current version unknown)')}`);
    } else if (version !== current) {
      console.log(`Update available (${channel}): ${chalk.gray(current)} → ${chalk.green(version)}`);
      console.log(chalk.gray(`Run \`simon update${options.nightly ? ' --nightly' : options.stable ? ' --stable' : ''}\` to install it.`));
    } else {
      console.log(chalk.green(`You're on the latest ${channel} version (${current}).`));
    }
  } catch (err) {
    stop();
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
