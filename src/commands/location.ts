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

// Physical iOS has no first-party location CLI (devicectl can't do it), so we
// shell out to go-ios. On iOS 17+ it also needs a developer tunnel running.
function goIos(args: string): void {
  try {
    execSync('command -v ios', { stdio: 'ignore' });
  } catch {
    throw new Error('go-ios is required to set location on a physical iOS device.\nInstall it:  npm install -g go-ios');
  }
  try {
    execSync(`ios ${args}`, { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    const stderr = (e as { stderr?: Buffer }).stderr?.toString().trim().split('\n')[0] ?? '';
    throw new Error(
      `go-ios failed${stderr ? `: ${stderr}` : ''}\n` +
        'On iOS 17+ a developer tunnel must be running first:  sudo ios tunnel start',
    );
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
      } else {
        if (options.reset) goIos(`resetlocation --udid=${device.udid}`);
        else goIos(`setlocation --lat=${parsed!.lat} --lon=${parsed!.lon} --udid=${device.udid}`);
      }
    } else {
      if (device.kind === 'physical') {
        console.error(chalk.red('Setting location on a physical Android device is not supported.'));
        console.error(chalk.gray('Use a mock-location app (e.g. Lockito) selected in Developer Options → "Select mock location app".'));
        process.exit(1);
      }
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
