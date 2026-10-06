import chalk from 'chalk';
import { ChildProcess, execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { RunningDevice, pickRunningDevice } from '../utils/devices.js';
import { ensureGoIos, ensureTunnel } from '../utils/goios.js';
import { streamReactNativeLogs } from '../utils/rnlogs.js';

interface LogsOptions {
  ios?: string | boolean;
  android?: string | boolean;
  filter?: string;
  app?: string;
  rn?: boolean;
  port?: string;
}

function getAdb(): string {
  const p = path.join(
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), 'Library', 'Android', 'sdk'),
    'platform-tools', 'adb',
  );
  return existsSync(p) ? p : 'adb';
}

// Build a `log stream` predicate from the raw filter and/or an app match.
// `--app` matches either the process name or the os_log subsystem (often the
// bundle id), so passing an app name or a bundle id both work on the simulator.
function iosPredicate(filter?: string, app?: string): string | undefined {
  const parts: string[] = [];
  if (app) parts.push(`(process CONTAINS[c] "${app}" OR subsystem CONTAINS[c] "${app}")`);
  if (filter) parts.push(`(${filter})`);
  return parts.length ? parts.join(' AND ') : undefined;
}

function androidPid(adb: string, serial: string, app: string): string | null {
  try {
    const out = execSync(`"${adb}" -s ${serial} shell pidof -s ${app}`, { encoding: 'utf8' }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export async function logsCommand(options: LogsOptions): Promise<void> {
  const platform = options.ios !== undefined ? 'ios' : options.android !== undefined ? 'android' : undefined;
  const name = typeof options.ios === 'string' ? options.ios
    : typeof options.android === 'string' ? options.android
    : undefined;

  try {
    if (options.rn) {
      await streamReactNativeLogs(options.port ? Number(options.port) : 8081, name);
      return;
    }

    const device = await pickRunningDevice('Select a device to stream logs from:', platform, name);
    console.log(chalk.cyan(`Streaming logs from ${device.name}`) + chalk.gray('  (Ctrl+C to stop)\n'));
    streamLogs(device, options.filter, options.app);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

function streamLogs(device: RunningDevice, filter?: string, app?: string): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);

  let proc: ChildProcess;

  if (device.platform === 'ios') {
    if (device.kind === 'simulator') {
      const args = ['simctl', 'spawn', device.udid, 'log', 'stream', '--level', 'debug'];
      const predicate = iosPredicate(filter, app);
      if (predicate) args.push('--predicate', predicate);
      proc = spawn('xcrun', args, { stdio: 'inherit' });
    } else {
      // Physical iOS: simctl can't read it — stream the device syslog via go-ios.
      ensureGoIos();
      ensureTunnel();
      const base = `ios syslog --udid ${device.udid}`;
      const cmd = app ? `${base} | grep -i -- "${app}"` : base;
      proc = spawn('sh', ['-c', cmd], { stdio: 'inherit' });
    }
  } else {
    const adb = getAdb();
    const args = ['-s', device.serial, 'logcat'];
    if (app) {
      const pid = androidPid(adb, device.serial, app);
      if (pid) args.push(`--pid=${pid}`);
      else console.error(chalk.yellow(`App "${app}" isn't running — showing all logs.`));
    }
    if (filter) args.push('-e', filter);
    proc = spawn(adb, args, { stdio: 'inherit' });
  }

  process.once('SIGINT', () => {
    proc.kill('SIGINT');
    process.exit(0);
  });
  proc.on('exit', () => process.exit(0));
}
