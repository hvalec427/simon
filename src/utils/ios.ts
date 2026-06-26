import { execSync, spawn } from 'child_process';

export interface Simulator {
  name: string;
  udid: string;
  state: string;
  runtime: string;
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

export function runningSimulators(): Simulator[] {
  return listSimulators().filter(s => s.state === 'Booted');
}
