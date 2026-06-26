import { execSync, spawn } from 'child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

function getSdkRoot(): string {
  return (
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(homedir(), 'Library', 'Android', 'sdk')
  );
}

function findBin(name: 'emulator' | 'adb'): string {
  const subdir = name === 'emulator' ? 'emulator' : 'platform-tools';
  const full = path.join(getSdkRoot(), subdir, name);
  return existsSync(full) ? full : name;
}

function findAvdManager(): string {
  const sdk = getSdkRoot();
  const candidates = [
    path.join(sdk, 'cmdline-tools', 'latest', 'bin', 'avdmanager'),
    ...(() => {
      const dir = path.join(sdk, 'cmdline-tools');
      if (!existsSync(dir)) return [];
      return readdirSync(dir)
        .filter(v => v !== 'latest')
        .map(v => path.join(dir, v, 'bin', 'avdmanager'));
    })(),
    path.join(sdk, 'tools', 'bin', 'avdmanager'),
  ];
  return candidates.find(p => existsSync(p)) ?? 'avdmanager';
}

// ── List ──────────────────────────────────────────────────────────────────────

export function listAvds(): string[] {
  try {
    const out = execSync(`"${findBin('emulator')}" -list-avds 2>/dev/null`, { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export interface DeviceDefinition {
  id: string;
  name: string;
}

export function listDeviceDefinitions(): DeviceDefinition[] {
  try {
    const out = execSync(`"${findAvdManager()}" list device 2>/dev/null`, { encoding: 'utf8' });
    const devices: DeviceDefinition[] = [];
    const SKIP = ['automotive', 'tv_', 'glass', 'wear', 'desktop', 'chromebook'];

    let currentId: string | null = null;
    for (const line of out.split('\n')) {
      const idMatch = line.match(/^id:\s+\d+\s+or\s+"([^"]+)"/);
      if (idMatch) { currentId = idMatch[1]; continue; }

      const nameMatch = line.match(/^\s+Name:\s+(.+)$/);
      if (nameMatch && currentId) {
        if (!SKIP.some(s => currentId!.startsWith(s))) {
          devices.push({ id: currentId, name: nameMatch[1].trim() });
        }
        currentId = null;
      }
    }
    return devices;
  } catch {
    return [];
  }
}

export interface SystemImage {
  api: string;
  variant: string;
  arch: string;
  package: string;
  label: string;
}

export function listInstalledSystemImages(): SystemImage[] {
  const sysImagesDir = path.join(getSdkRoot(), 'system-images');
  if (!existsSync(sysImagesDir)) return [];

  const images: SystemImage[] = [];
  try {
    for (const apiDir of readdirSync(sysImagesDir)) {
      const apiPath = path.join(sysImagesDir, apiDir);
      if (!statSync(apiPath).isDirectory()) continue;
      for (const variant of readdirSync(apiPath)) {
        const variantPath = path.join(apiPath, variant);
        if (!statSync(variantPath).isDirectory()) continue;
        for (const arch of readdirSync(variantPath)) {
          const api = apiDir.replace('android-', '');
          images.push({
            api,
            variant,
            arch,
            package: `system-images;${apiDir};${variant};${arch}`,
            label: `API ${api}  ${variant}  (${arch})`,
          });
        }
      }
    }
  } catch {}

  return images.sort((a, b) => parseInt(b.api) - parseInt(a.api));
}

export interface PhysicalAndroidDevice {
  serial: string;
  name: string;
}

export function connectedAndroidDevices(): PhysicalAndroidDevice[] {
  const adb = findBin('adb');
  try {
    const out = execSync(`"${adb}" devices 2>/dev/null`, { encoding: 'utf8' });
    const serials = out
      .split('\n')
      .filter(l => !l.startsWith('emulator-') && l.includes('\tdevice'))
      .map(l => l.split('\t')[0].trim())
      .filter(Boolean);

    return serials.map(serial => {
      try {
        const model = execSync(`"${adb}" -s ${serial} shell getprop ro.product.model 2>/dev/null`, {
          encoding: 'utf8',
          timeout: 3000,
        });
        return { serial, name: model.trim() || serial };
      } catch {
        return { serial, name: serial };
      }
    });
  } catch {
    return [];
  }
}

// ── Running ───────────────────────────────────────────────────────────────────

export interface RunningEmulator {
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

// ── Actions ───────────────────────────────────────────────────────────────────

export function launchAvd(name: string): void {
  const emulatorBin = findBin('emulator');

  const child = spawn(emulatorBin, ['-avd', name], {
    detached: true,
    stdio: ['ignore', 'ignore', 'pipe'],
    cwd: path.dirname(emulatorBin),
    env: { ...process.env, ANDROID_HOME: getSdkRoot(), ANDROID_SDK_ROOT: getSdkRoot() },
  });

  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

  child.on('exit', code => {
    if (code !== 0) {
      const fatal = stderr.split('\n').find(l => l.includes('FATAL') || l.includes('Error:'));
      if (fatal) process.stderr.write(fatal.replace(/.*\| /, '').trim() + '\n');
    }
  });

  setTimeout(() => { child.stderr?.destroy(); child.unref(); }, 5000).unref();
}

export function stopEmulator(serial: string): void {
  execSync(`"${findBin('adb')}" -s ${serial} emu kill 2>/dev/null`);
}

export function openUrlOnEmulator(serial: string, url: string): void {
  execSync(`"${findBin('adb')}" -s ${serial} shell am start -a android.intent.action.VIEW -d "${url}"`);
}

export function openUrlOnPhysicalAndroid(serial: string, url: string): void {
  execSync(`"${findBin('adb')}" -s ${serial} shell am start -a android.intent.action.VIEW -d "${url}"`);
}

export function deleteAvd(name: string): void {
  execSync(`"${findAvdManager()}" delete avd -n "${name}"`);
}

export function createAvd(name: string, deviceId: string, systemImage: string): void {
  execSync(
    `echo no | "${findAvdManager()}" create avd -n "${name}" -k "${systemImage}" -d "${deviceId}" 2>&1`,
    { encoding: 'utf8' }
  );
}

export function takeScreenshot(serial: string, outputPath: string): void {
  const adb = findBin('adb');
  const buf = execSync(`"${adb}" -s ${serial} exec-out screencap -p`, { maxBuffer: 50 * 1024 * 1024 });
  writeFileSync(outputPath, buf);
}

export function wipeAvd(name: string): void {
  const iniFile = path.join(homedir(), '.android', 'avd', `${name}.ini`);
  let avdPath = path.join(homedir(), '.android', 'avd', `${name}.avd`);

  if (existsSync(iniFile)) {
    const ini = readFileSync(iniFile, 'utf8');
    const match = ini.match(/^path\s*=\s*(.+)$/m);
    if (match) avdPath = match[1].trim();
  }

  for (const pattern of ['userdata-qemu.img', 'userdata-qemu.img.qcow2', 'cache.img', 'cache.img.qcow2']) {
    const f = path.join(avdPath, pattern);
    if (existsSync(f)) rmSync(f);
  }
}
