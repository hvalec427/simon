import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { RunningDevice, pickRunningDevice } from '../utils/devices.js';

interface LogsOptions {
  ios?: string | boolean;
  android?: string | boolean;
  filter?: string;
}

function getAdb(): string {
  const p = path.join(
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), 'Library', 'Android', 'sdk'),
    'platform-tools', 'adb',
  );
  return existsSync(p) ? p : 'adb';
}

export async function logsCommand(options: LogsOptions): Promise<void> {
  const filter = options.ios !== undefined ? 'ios' : options.android !== undefined ? 'android' : undefined;
  const name = typeof options.ios === 'string' ? options.ios
    : typeof options.android === 'string' ? options.android
    : undefined;

  const device = await pickRunningDevice('Select a device to stream logs from:', filter, name);

  console.log(chalk.cyan(`Streaming logs from ${device.name}`) + chalk.gray('  (Ctrl+C to stop)\n'));

  streamLogs(device, options.filter);
}

function streamLogs(device: RunningDevice, filter?: string): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);

  let proc;

  if (device.platform === 'ios') {
    const args = ['simctl', 'spawn', device.udid, 'log', 'stream', '--level', 'debug'];
    if (filter) args.push('--predicate', filter);
    proc = spawn('xcrun', args, { stdio: 'inherit' });
  } else {
    const args = ['-s', device.serial, 'logcat'];
    if (filter) args.push('-e', filter);
    proc = spawn(getAdb(), args, { stdio: 'inherit' });
  }

  process.once('SIGINT', () => { proc.kill('SIGINT'); process.exit(0); });
  proc.on('exit', () => process.exit(0));
}
