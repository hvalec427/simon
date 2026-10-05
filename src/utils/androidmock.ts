import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { findBin } from './android.js';
import { spinner } from './prompt.js';

const PKG = 'dev.simon.mocklocation';
const ACTIVITY = `${PKG}/.MockLocationActivity`;
// The helper APK is a tiny, rarely-changing artifact committed to the repo.
const APK_URL = 'https://raw.githubusercontent.com/hvalec427/simon/master/android/simon-mock-location.apk';

function adb(serial: string, cmd: string, capture = false): string {
  const out = execSync(`"${findBin('adb')}" -s ${serial} ${cmd}`, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'ignore', 'pipe'],
  });
  return out ?? '';
}

function isHelperInstalled(serial: string): boolean {
  try {
    return adb(serial, `shell pm list packages ${PKG}`, true).includes(PKG);
  } catch {
    return false;
  }
}

async function installHelper(serial: string): Promise<void> {
  const stop = spinner('Installing the mock-location helper app...');
  try {
    const res = await fetch(APK_URL);
    if (!res.ok) throw new Error(`could not download the helper APK (${res.status})`);
    const tmp = '/tmp/simon-mock-location.apk';
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
    adb(serial, `install -r "${tmp}"`);
    stop();
  } catch (e) {
    stop();
    throw new Error(
      `Mock-location helper setup failed: ${e instanceof Error ? e.message : String(e)}\n` +
        'You can build it yourself: cd android && ./gradlew assembleDebug, then `adb install` the APK.',
    );
  }
}

export async function setAndroidDeviceLocation(serial: string, lat: string, lon: string): Promise<void> {
  if (!isHelperInstalled(serial)) await installHelper(serial);

  try {
    adb(serial, `shell appops set ${PKG} android:mock_location allow`);
  } catch {
    throw new Error('Could not enable mock locations. Turn on Developer Options on the device, then try again.');
  }

  // Grant the runtime location permissions the provider needs (best effort).
  try {
    adb(serial, `shell pm grant ${PKG} android.permission.ACCESS_FINE_LOCATION`);
    adb(serial, `shell pm grant ${PKG} android.permission.ACCESS_COARSE_LOCATION`);
  } catch {
    /* some devices auto-grant or disallow; the helper still works in most cases */
  }

  adb(serial, `shell am start -n ${ACTIVITY} --es lat ${lat} --es lon ${lon}`);
}

export function resetAndroidDeviceLocation(serial: string): void {
  if (!isHelperInstalled(serial)) return;
  try {
    adb(serial, `shell am start -n ${ACTIVITY} --ez stop true`);
  } catch {
    /* nothing to clear */
  }
}
