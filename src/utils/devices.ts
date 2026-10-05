import chalk from 'chalk';
import { getRunningAndroidDevicesAsync, listAvds, runningAvdNames } from './android.js';
import { getRunningIosDevicesAsync, listSimulators } from './ios.js';
import { selectWithExit, spinner } from './prompt.js';

export type RunningDevice =
  | { platform: 'ios'; kind: 'simulator'; name: string; udid: string; runtime: string }
  | { platform: 'ios'; kind: 'physical'; name: string; udid: string; osVersion: string }
  | { platform: 'android'; kind: 'emulator'; name: string; serial: string }
  | { platform: 'android'; kind: 'physical'; name: string; serial: string };

// Installed simulators/emulators (not physical devices), with current run state.
// Used by commands that target things you can launch/delete/wipe.
export type InstalledDevice =
  | { platform: 'ios'; name: string; udid: string; runtime: string; running: boolean }
  | { platform: 'android'; name: string; running: boolean };

export async function getAllRunningDevices(filter?: 'ios' | 'android'): Promise<RunningDevice[]> {
  const [ios, android] = await Promise.all([
    filter !== 'android' ? getRunningIosDevicesAsync() : { simulators: [], physical: [] },
    filter !== 'ios' ? getRunningAndroidDevicesAsync() : { emulators: [], physical: [] },
  ]);

  return [
    ...ios.simulators.map(s => ({ platform: 'ios' as const, kind: 'simulator' as const, name: s.name, udid: s.udid, runtime: s.runtime })),
    ...ios.physical.map(d => ({ platform: 'ios' as const, kind: 'physical' as const, name: d.name, udid: d.udid, osVersion: d.osVersion })),
    ...android.emulators.map(e => ({ platform: 'android' as const, kind: 'emulator' as const, name: e.name, serial: e.serial })),
    ...android.physical.map(d => ({ platform: 'android' as const, kind: 'physical' as const, name: d.name, serial: d.serial })),
  ];
}

export function deviceLabel(d: RunningDevice): string {
  if (d.platform === 'ios') {
    return d.kind === 'simulator'
      ? `${d.name}  ${chalk.gray(d.runtime + ' · simulator')}`
      : `${d.name}  ${chalk.gray(`iOS ${d.osVersion} · physical`)}`;
  }
  return `${d.name}  ${chalk.gray(d.kind === 'emulator' ? 'emulator' : 'physical')}`;
}

export async function pickRunningDevice(
  message: string,
  filter?: 'ios' | 'android',
  name?: string,
  excludePhysical = false,
): Promise<RunningDevice> {
  const stop = spinner('Loading devices...');
  let devices = await getAllRunningDevices(filter);
  stop();
  if (excludePhysical) devices = devices.filter(d => d.kind !== 'physical');

  if (devices.length === 0) {
    const what = filter === 'ios'
      ? 'iOS simulators or devices'
      : filter === 'android'
      ? 'Android emulators or devices'
      : 'simulators or devices';
    console.error(chalk.red(`No running ${what} found.`));
    process.exit(1);
  }

  if (name) {
    const found = devices.find(
      d => d.name === name || ('udid' in d && d.udid === name) || ('serial' in d && d.serial === name),
    );
    if (!found) {
      console.error(chalk.red(`Device "${name}" not found or not running.`));
      process.exit(1);
    }
    return found;
  }

  if (devices.length === 1) return devices[0];

  return selectWithExit(message, devices.map(d => ({ name: deviceLabel(d), value: d })));
}

export function getAllInstalledDevices(filter?: 'ios' | 'android'): InstalledDevice[] {
  const sims = filter !== 'android' ? listSimulators() : [];
  const avds = filter !== 'ios' ? listAvds() : [];
  const running = filter !== 'ios' ? new Set(runningAvdNames()) : new Set<string>();

  return [
    ...sims.map(s => ({
      platform: 'ios' as const,
      name: s.name,
      udid: s.udid,
      runtime: s.runtime,
      running: s.state === 'Booted',
    })),
    ...avds.map(a => ({ platform: 'android' as const, name: a, running: running.has(a) })),
  ];
}

function installedLabel(d: InstalledDevice): string {
  const running = d.running ? chalk.green('  ● running') : '';
  return d.platform === 'ios'
    ? `${d.name}  ${chalk.gray(d.runtime + ' · simulator')}${running}`
    : `${d.name}  ${chalk.gray('emulator')}${running}`;
}

export async function pickInstalledDevice(
  message: string,
  opts: { filter?: 'ios' | 'android'; name?: string; excludeRunning?: boolean } = {},
): Promise<InstalledDevice> {
  const stop = spinner('Loading devices...');
  const all = getAllInstalledDevices(opts.filter);
  stop();

  // A name targets a device directly, even if it is running (callers guard that).
  if (opts.name) {
    const found = all.find(d => d.name === opts.name || ('udid' in d && d.udid === opts.name));
    if (!found) {
      console.error(chalk.red(`Device "${opts.name}" not found.`));
      process.exit(1);
    }
    return found;
  }

  const devices = opts.excludeRunning ? all.filter(d => !d.running) : all;
  if (devices.length === 0) {
    console.error(
      chalk.red(opts.excludeRunning ? 'No stopped simulators or emulators found.' : 'No simulators or emulators found.'),
    );
    process.exit(1);
  }

  if (devices.length === 1) return devices[0];

  return selectWithExit(message, devices.map(d => ({ name: installedLabel(d), value: d })));
}
