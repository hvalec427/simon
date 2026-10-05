import chalk from 'chalk';
import { execSync } from 'child_process';
import { findBin } from '../utils/android.js';
import { pickRunningDevice } from '../utils/devices.js';

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

  // Location can only be set on simulators/emulators, so physical devices are excluded.
  const device = await pickRunningDevice('Select a device to set location on:', filter, name, true);

  try {
    if (device.platform === 'ios') {
      if (options.reset) execSync(`xcrun simctl location "${device.udid}" clear`);
      else execSync(`xcrun simctl location "${device.udid}" set ${parsed!.lat},${parsed!.lon}`);
    } else {
      if (options.reset) {
        console.error(chalk.yellow('Android emulators have no location reset — set a new location instead.'));
        process.exit(1);
      }
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
