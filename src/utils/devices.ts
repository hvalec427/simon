import chalk from 'chalk';
import { connectedAndroidDevices, runningEmulators } from './android.js';
import { listPhysicalIosDevices, runningSimulators } from './ios.js';
import { selectWithExit } from './prompt.js';

export type RunningDevice =
  | { platform: 'ios'; kind: 'simulator'; name: string; udid: string; runtime: string }
  | { platform: 'ios'; kind: 'physical'; name: string; udid: string; osVersion: string }
  | { platform: 'android'; kind: 'emulator'; name: string; serial: string }
  | { platform: 'android'; kind: 'physical'; name: string; serial: string };

export function getAllRunningDevices(filter?: 'ios' | 'android'): RunningDevice[] {
  const devices: RunningDevice[] = [];

  if (!filter || filter === 'ios') {
    for (const s of runningSimulators())
      devices.push({ platform: 'ios', kind: 'simulator', name: s.name, udid: s.udid, runtime: s.runtime });
    for (const d of listPhysicalIosDevices())
      devices.push({ platform: 'ios', kind: 'physical', name: d.name, udid: d.udid, osVersion: d.osVersion });
  }

  if (!filter || filter === 'android') {
    for (const e of runningEmulators())
      devices.push({ platform: 'android', kind: 'emulator', name: e.name, serial: e.serial });
    for (const d of connectedAndroidDevices())
      devices.push({ platform: 'android', kind: 'physical', name: d.name, serial: d.serial });
  }

  return devices;
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
  const devices = getAllRunningDevices(filter);

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
