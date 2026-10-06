import chalk from 'chalk';
import { spinner } from '../utils/prompt.js';
import {
  Channel,
  currentVersion,
  changelogSince,
  downloadBinary,
  installBinary,
  installTarget,
  latestForChannel,
  needsSudo,
  loadChannel,
  platformSupported,
  saveChannel,
} from '../utils/update.js';

interface UpdateOptions {
  nightly?: boolean;
  stable?: boolean;
}

// A channel flag both selects and remembers the channel; otherwise use the saved one.
function resolveChannel(options: UpdateOptions): Channel {
  if (options.nightly) {
    saveChannel('nightly');
    return 'nightly';
  }
  if (options.stable) {
    saveChannel('stable');
    return 'stable';
  }
  return loadChannel();
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  if (!platformSupported()) {
    console.error(chalk.yellow('simon self-update is macOS-only (arm64/x64). Build from source on other platforms.'));
    process.exit(1);
  }
  const channel = resolveChannel(options);
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

  if (current !== 'unknown' && current === latest.version) {
    console.log(chalk.green(`Already on the latest ${channel} version (${current}).`));
    return;
  }

  console.log(`Updating ${chalk.gray(current)} → ${chalk.green(latest.version)} ${chalk.gray(`(${channel})`)}...`);

  const notes = await changelogSince(channel, current);
  if (notes) {
    console.log();
    console.log(chalk.bold(`What's new (${current} → ${latest.version}):`));
    console.log(chalk.gray(notes));
    console.log();
  }

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

  const target = installTarget();
  const sudoNote = needsSudo(target) ? ' (needs sudo — may prompt for your password)' : '';
  console.log(chalk.gray(`Installing to ${target}${sudoNote}...`));
  try {
    installBinary(tmp, target);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  console.log(chalk.green(`Updated to ${latest.version} (${channel}).`));
}
