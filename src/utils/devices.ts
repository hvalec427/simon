import chalk from 'chalk';
import { getRunningAndroidDevicesAsync } from './android.js';
import { getRunningIosDevicesAsync } from './ios.js';
import { selectWithExit } from './prompt.js';

export type RunningDevice =
  | { platform: 'ios'; kind: 'simulator'; name: string; udid: string; runtime: string }
  | { platform: 'ios'; kind: 'physical'; name: string; udid: string; osVersion: string }
  | { platform: 'android'; kind: 'emulator'; name: string; serial: string }
  | { platform: 'android'; kind: 'physical'; name: string; serial: string };

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
): Promise<RunningDevice> {
  const devices = await getAllRunningDevices(filter);

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
