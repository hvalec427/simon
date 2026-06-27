import chalk from 'chalk';
import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { RunningDevice, pickRunningDevice } from '../utils/devices.js';
import { spinner } from '../utils/prompt.js';

interface RecordOptions {
  ios?: string | boolean;
  android?: string | boolean;
  output?: string;
}

function defaultPath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return path.join(homedir(), 'Desktop', `simon_recording_${ts}.mp4`);
}

function getAdb(): string {
  const p = path.join(
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), 'Library', 'Android', 'sdk'),
    'platform-tools', 'adb',
  );
  return existsSync(p) ? p : 'adb';
}

export async function recordCommand(options: RecordOptions): Promise<void> {
  const filter = options.ios !== undefined ? 'ios' : options.android !== undefined ? 'android' : undefined;
  const name = typeof options.ios === 'string' ? options.ios
    : typeof options.android === 'string' ? options.android
    : undefined;

  const device = await pickRunningDevice('Select a device to record:', filter, name);

  if (device.platform === 'ios' && device.kind === 'physical') {
    console.error(chalk.red('Screen recording is not supported on physical iOS devices.'));
    process.exit(1);
  }

  const outputPath = options.output ?? defaultPath();

  if (device.platform === 'ios') {
    await recordIos(device.udid, outputPath);
  } else {
    await recordAndroid(device.serial, outputPath);
  }
}

async function recordIos(udid: string, outputPath: string): Promise<void> {
  console.log(chalk.cyan('Recording... Press Ctrl+C to stop.'));

  const proc = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', outputPath], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const exitPromise = new Promise<void>(resolve => proc.on('exit', resolve));
  let stopping = false;
  let stopSpinner: (() => void) | undefined;

  process.once('SIGINT', () => {
    stopping = true;
    process.stdout.write('\n');
    stopSpinner = spinner('Saving...');
    // xcrun already received SIGINT from the terminal — do not send a second one
  });

  await exitPromise;
  stopSpinner?.();

  if (stopping) {
    console.log(chalk.green(`Saved to ${outputPath}`));
    process.exit(0);
  } else {
    console.log(chalk.green(`\nSaved to ${outputPath}`));
  }
}

async function recordAndroid(serial: string, outputPath: string): Promise<void> {
  const adb = getAdb();
  const remoteFile = `/sdcard/simon_rec_${Date.now()}.mp4`;

  console.log(chalk.cyan('Recording... Press Ctrl+C to stop.') + chalk.gray('  (max 3 min)'));

  const proc = spawn(adb, ['-s', serial, 'shell', 'screenrecord', remoteFile], {
    stdio: ['inherit', 'inherit', 'pipe'],
  });

  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (!/ERROR: unable to configure|WARNING: failed at/.test(text)) process.stderr.write(text);
  });

  let saved = false;

  const save = async (): Promise<void> => {
    if (saved) return;
    saved = true;
    process.stdout.write('\n');
    const stopSpin = spinner('Saving...');
    try {
      execSync(`"${adb}" -s ${serial} pull "${remoteFile}" "${outputPath}" 2>/dev/null`);
      execSync(`"${adb}" -s ${serial} shell rm "${remoteFile}" 2>/dev/null`);
      stopSpin();
      console.log(chalk.green(`Saved to ${outputPath}`));
    } catch {
      stopSpin();
      console.error(chalk.red('Failed to pull recording from device.'));
    }
  };

  process.once('SIGINT', async () => {
    proc.kill('SIGINT');
    await new Promise<void>(resolve => proc.once('exit', resolve));
    await save();
    process.exit(0);
  });

  await new Promise<void>(resolve => proc.on('exit', resolve));
  await save(); // handles the 3-min auto-stop case
}
