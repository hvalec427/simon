import chalk from 'chalk';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { getRunningAndroidDevicesAsync, listAvds } from '../utils/android.js';
import { PhysicalIosDevice, listSimulators } from '../utils/ios.js';
import { spinner } from '../utils/prompt.js';

interface ListOptions {
  ios?: boolean;
  android?: boolean;
}

function fetchPhysicalIosAsync(): Promise<PhysicalIosDevice[]> {
  return new Promise(resolve => {
    const tmp = '/tmp/simon-list-devicectl.json';
    exec(`xcrun devicectl list devices --json-output "${tmp}" 2>/dev/null`, () => {
      try {
        const data = JSON.parse(readFileSync(tmp, 'utf8'));
        resolve(
          (data.result?.devices ?? [])
            .filter((d: any) => d.connectionProperties?.transportType)
            .map((d: any) => ({
              name: d.deviceProperties?.name ?? d.hardwareProperties?.marketingName ?? 'Unknown',
              udid: d.hardwareProperties?.udid ?? d.identifier,
              osVersion: d.deviceProperties?.osVersionNumber ?? '',
            })),
        );
      } catch { resolve([]); }
    });
  });
}

export async function listCommand(options: ListOptions): Promise<void> {
  const showIos = !options.ios && !options.android ? true : !!options.ios;
  const showAndroid = !options.ios && !options.android ? true : !!options.android;

  const stop = spinner('Loading devices...');

  const [sims, iosPhysical, avds, android] = await Promise.all([
    Promise.resolve(showIos ? listSimulators() : []),
    showIos ? fetchPhysicalIosAsync() : Promise.resolve([]),
    Promise.resolve(showAndroid ? listAvds() : []),
    showAndroid
      ? getRunningAndroidDevicesAsync()
      : Promise.resolve({ emulators: [], physical: [] }),
  ]);

  stop();

  if (showIos) {
    console.log(chalk.bold.blue('\niOS Simulators'));
    console.log(chalk.gray('─'.repeat(50)));
    if (sims.length === 0) {
      console.log(chalk.gray('  No simulators found'));
    } else {
      for (const sim of sims) {
        const dot = sim.state === 'Booted' ? chalk.green('●') : chalk.gray('○');
        const status = sim.state === 'Booted' ? chalk.green(' running') : '';
        console.log(`  ${dot}  ${sim.name}${status}  ${chalk.gray(sim.runtime)}`);
      }
    }

    console.log(chalk.bold.blue('\niOS Physical Devices'));
    console.log(chalk.gray('─'.repeat(50)));
    if (iosPhysical.length === 0) {
      console.log(chalk.gray('  No devices connected'));
    } else {
      for (const d of iosPhysical) {
        console.log(`  ${chalk.green('●')}  ${d.name}  ${chalk.gray(`iOS ${d.osVersion}`)}`);
      }
    }
  }

  if (showAndroid) {
    const runningNames = new Set(android.emulators.map(e => e.name));
    console.log(chalk.bold.blue('\nAndroid Emulators'));
    console.log(chalk.gray('─'.repeat(50)));
    if (avds.length === 0) {
      console.log(chalk.gray('  No emulators found'));
    } else {
      for (const avd of avds) {
        const isRunning = runningNames.has(avd);
        const dot = isRunning ? chalk.green('●') : chalk.gray('○');
        const status = isRunning ? chalk.green(' running') : '';
        console.log(`  ${dot}  ${avd}${status}`);
      }
    }

    console.log(chalk.bold.blue('\nAndroid Physical Devices'));
    console.log(chalk.gray('─'.repeat(50)));
    if (android.physical.length === 0) {
      console.log(chalk.gray('  No devices connected'));
    } else {
      for (const d of android.physical) {
        console.log(`  ${chalk.green('●')}  ${d.name}  ${chalk.gray(d.serial)}`);
      }
    }
  }

  console.log();
}
