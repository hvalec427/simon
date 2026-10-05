import chalk from 'chalk';
import { execSync } from 'child_process';
import { findBin } from '../utils/android.js';
import { pickRunningDevice } from '../utils/devices.js';
import { ensureGoIos, ensureTunnel, stopTunnel } from '../utils/goios.js';
import { resetAndroidDeviceLocation, setAndroidDeviceLocation } from '../utils/androidmock.js';

interface LocationOptions {
  ios?: string | boolean;
  android?: string | boolean;
  reset?: boolean;
}

// Coordinates come as one argument ("lat,lon" or "lat lon") rather than two, so a
// negative longitude/latitude isn't mistaken for a CLI option by the parser.
function parseCoords(coords: string): { lat: string; lon: string } | null {
  const parts = coords.split(/[,\s]+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const [lat, lon] = parts;
  if (Number.isNaN(Number(lat)) || Number.isNaN(Number(lon))) return null;
  return { lat, lon };
}

// Physical iOS has no first-party location CLI (devicectl can't do it), so we
// shell out to go-ios, installing it and starting the developer tunnel as needed.
function goIos(args: string): void {
  ensureGoIos();
  ensureTunnel();
  try {
    execSync(`ios ${args}`, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim().split('\n')[0] ?? '';
    throw new Error(`go-ios failed${stderr ? `: ${stderr}` : ''}`);
  }
}

export async function locationCommand(coords: string | undefined, options: LocationOptions): Promise<void> {
  const filter = options.ios !== undefined ? 'ios' : options.android !== undefined ? 'android' : undefined;
  const name = typeof options.ios === 'string' ? options.ios
    : typeof options.android === 'string' ? options.android
    : undefined;

  let parsed: { lat: string; lon: string } | null = null;
  if (!options.reset) {
    if (!coords) {
      console.error(chalk.red('Provide coordinates as "lat,lon", e.g. `simon location 51.5074,-0.1278` (or --reset).'));
      process.exit(1);
    }
    parsed = parseCoords(coords);
    if (!parsed) {
      console.error(chalk.red('Coordinates must be two numbers, e.g. "51.5074,-0.1278".'));
      process.exit(1);
    }
  }

  const device = await pickRunningDevice('Select a device to set location on:', filter, name);

  try {
    if (device.platform === 'ios') {
      if (device.kind === 'simulator') {
        if (options.reset) execSync(`xcrun simctl location "${device.udid}" clear`);
        else execSync(`xcrun simctl location "${device.udid}" set ${parsed!.lat},${parsed!.lon}`);
      } else if (options.reset) {
        goIos(`resetlocation --udid=${device.udid}`);
        // Clean up: the tunnel was only needed to clear the location.
        if (stopTunnel()) console.log(chalk.gray('Stopped the iOS developer tunnel.'));
      } else {
        goIos(`setlocation --lat=${parsed!.lat} --lon=${parsed!.lon} --udid=${device.udid}`);
      }
    } else if (device.kind === 'physical') {
      // Real Android has no GPS-mock CLI; simon ships a tiny helper app it drives.
      if (options.reset) resetAndroidDeviceLocation(device.serial);
      else await setAndroidDeviceLocation(device.serial, parsed!.lat, parsed!.lon);
    } else if (options.reset) {
      console.error(chalk.yellow('Android emulators have no location reset — set a new location instead.'));
      process.exit(1);
    } else {
      // `adb emu geo fix` takes longitude first, then latitude.
      execSync(`"${findBin('adb')}" -s ${device.serial} emu geo fix ${parsed!.lon} ${parsed!.lat}`);
    }

    console.log(
      chalk.green(
        options.reset ? `Cleared location on ${device.name}.` : `Set ${device.name} to ${parsed!.lat}, ${parsed!.lon}.`,
      ),
    );
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
