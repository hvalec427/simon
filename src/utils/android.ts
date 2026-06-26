import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

function findBin(name: 'emulator' | 'adb'): string {
  const sdkRoot =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(homedir(), 'Library', 'Android', 'sdk');

  const subdir = name === 'emulator' ? 'emulator' : 'platform-tools';
  const full = path.join(sdkRoot, subdir, name);

  if (existsSync(full)) return full;
  return name; // fall back to PATH
}

export function listAvds(): string[] {
  try {
    const out = execSync(`"${findBin('emulator')}" -list-avds 2>/dev/null`, { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

interface RunningEmulator {
  serial: string;
  name: string;
}

export function runningEmulators(): RunningEmulator[] {
  const adb = findBin('adb');
  try {
    const out = execSync(`"${adb}" devices 2>/dev/null`, { encoding: 'utf8' });
    const serials = out
      .split('\n')
      .filter(l => l.startsWith('emulator-') && l.includes('\tdevice'))
      .map(l => l.split('\t')[0].trim());

    return serials.map(serial => {
      try {
        const name = execSync(`"${adb}" -s ${serial} emu avd name 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 3000,
        });
        return { serial, name: name.trim().split('\n')[0].trim() };
      } catch {
        return { serial, name: serial };
      }
    });
  } catch {
    return [];
  }
}

export function runningAvdNames(): string[] {
  return runningEmulators().map(e => e.name);
}

export function launchAvd(name: string): void {
  const child = spawn(findBin('emulator'), ['-avd', name], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export function stopEmulator(serial: string): void {
  const adb = findBin('adb');
  execSync(`"${adb}" -s ${serial} emu kill 2>/dev/null`);
}
