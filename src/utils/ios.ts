import { execSync, spawn } from 'child_process';
import { readFileSync } from 'fs';

export interface Simulator {
  name: string;
  udid: string;
  state: string;
  runtime: string;
}

export interface PhysicalIosDevice {
  name: string;
  udid: string;
  osVersion: string;
}

export interface DeviceType {
  name: string;
  identifier: string;
}

export interface Runtime {
  name: string;
  identifier: string;
  version: string;
}

interface SimctlDevice {
  name: string;
  udid: string;
  state: string;
  isAvailable: boolean;
}

export function listSimulators(): Simulator[] {
  try {
    const out = execSync('xcrun simctl list devices --json', { encoding: 'utf8' });
    const data = JSON.parse(out) as { devices: Record<string, SimctlDevice[]> };
    const sims: Simulator[] = [];

    for (const [runtime, devices] of Object.entries(data.devices)) {
      const label = runtime
        .replace('com.apple.CoreSimulator.SimRuntime.', '')
        .replace(/-/g, ' ')
        .replace(/(\w+)\s(\d+)\s(\d+)/, '$1 $2.$3');

      for (const d of devices) {
        if (d.isAvailable) {
          sims.push({ name: d.name, udid: d.udid, state: d.state, runtime: label });
        }
      }
    }

    return sims.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function listPhysicalIosDevices(): PhysicalIosDevice[] {
  const tmpFile = '/tmp/simon-devicectl.json';
  try {
    execSync(`xcrun devicectl list devices --json-output "${tmpFile}" 2>/dev/null`);
    const data = JSON.parse(readFileSync(tmpFile, 'utf8'));
    return (data.result?.devices ?? [])
      .filter((d: any) => d.connectionProperties?.transportType)
      .map((d: any) => ({
        name: d.deviceProperties?.name ?? d.hardwareProperties?.marketingName ?? 'Unknown',
        udid: d.hardwareProperties?.udid ?? d.identifier,
        osVersion: d.deviceProperties?.osVersionNumber ?? '',
      }));
  } catch {
    return [];
  }
}

export function listDeviceTypes(): DeviceType[] {
  try {
    const out = execSync('xcrun simctl list devicetypes --json', { encoding: 'utf8' });
    const data = JSON.parse(out) as { devicetypes: { name: string; identifier: string }[] };
    return data.devicetypes.filter(
      d => d.name.includes('iPhone') || d.name.includes('iPad')
    );
  } catch {
    return [];
  }
}

export function listRuntimes(): Runtime[] {
  try {
    const out = execSync('xcrun simctl list runtimes --json', { encoding: 'utf8' });
    const data = JSON.parse(out) as {
      runtimes: { name: string; identifier: string; version: string; isAvailable: boolean }[];
    };
    return data.runtimes.filter(r => r.isAvailable && r.name.includes('iOS'));
  } catch {
    return [];
  }
}

export function bootSimulator(udid: string): void {
  try {
    execSync(`xcrun simctl boot "${udid}" 2>/dev/null`);
  } catch {
    // already booted is fine
  }
  spawn('open', ['-a', 'Simulator'], { detached: true, stdio: 'ignore' }).unref();
}

export function shutdownSimulator(udid: string): void {
  execSync(`xcrun simctl shutdown "${udid}" 2>/dev/null`);
}

export function createSimulator(name: string, deviceType: string, runtime: string): string {
  const out = execSync(`xcrun simctl create "${name}" "${deviceType}" "${runtime}"`, {
    encoding: 'utf8',
  });
  return out.trim();
}

export function deleteSimulator(udid: string): void {
  execSync(`xcrun simctl delete "${udid}"`);
}

export function openUrlOnSimulator(udid: string, url: string): void {
  execSync(`xcrun simctl openurl "${udid}" "${url}"`);
}

export function openUrlOnPhysicalIos(udid: string, url: string): void {
  try {
    execSync('which idb', { stdio: 'ignore' });
  } catch {
    throw new Error(
      'idb is required to open links on physical iOS devices.\nInstall it with:\n  brew install idb-companion\n  pip3 install fb-idb'
    );
  }
  execSync(`idb open --udid "${udid}" "${url}"`);
}

export function runningSimulators(): Simulator[] {
  return listSimulators().filter(s => s.state === 'Booted');
}

export function takeScreenshot(udid: string, outputPath: string): void {
  execSync(`xcrun simctl io "${udid}" screenshot "${outputPath}"`);
}
