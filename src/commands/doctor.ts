import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { findBin, getSdkRoot } from '../utils/android.js';
import { spinner } from '../utils/prompt.js';
import { compareVersions, currentVersion, latestRelease } from '../utils/update.js';

type Status = 'ok' | 'warn' | 'fail';
interface Check {
  status: Status;
  label: string;
  detail?: string;
  fix?: string;
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function xcodeCheck(): Check {
  const dir = tryExec('xcode-select -p');
  if (!dir) {
    return { status: 'fail', label: 'Xcode', detail: 'not found', fix: 'xcode-select --install' };
  }
  if (dir.includes('CommandLineTools')) {
    return {
      status: 'warn',
      label: 'Xcode',
      detail: 'Command Line Tools only (no full Xcode)',
      fix: 'Install Xcode, then: sudo xcode-select -s /Applications/Xcode.app',
    };
  }
  return { status: 'ok', label: 'Xcode', detail: dir };
}

function xcrunToolCheck(tool: string, warnIfMissing: boolean, fix?: string): Check {
  const p = tryExec(`xcrun -f ${tool}`);
  if (p) return { status: 'ok', label: tool, detail: p };
  return { status: warnIfMissing ? 'warn' : 'fail', label: tool, detail: 'not found', fix };
}

function androidSdkCheck(): Check {
  const root = getSdkRoot();
  if (existsSync(root)) return { status: 'ok', label: 'Android SDK', detail: root };
  return {
    status: 'fail',
    label: 'Android SDK',
    detail: `not found at ${root}`,
    fix: 'Install the Android SDK or set ANDROID_HOME',
  };
}

function adbCheck(): Check {
  const adb = findBin('adb');
  const version = tryExec(`"${adb}" version`);
  if (version) return { status: 'ok', label: 'adb', detail: version.split('\n')[0] };
  return { status: 'fail', label: 'adb', detail: 'not found', fix: 'Install platform-tools (Android SDK)' };
}

function emulatorCheck(): Check {
  const emu = findBin('emulator');
  if (existsSync(emu)) return { status: 'ok', label: 'emulator', detail: emu };
  return { status: 'warn', label: 'emulator', detail: 'not found', fix: 'Install the emulator package via SDK Manager' };
}

async function versionCheck(): Promise<Check> {
  const current = currentVersion();
  try {
    const { version } = await latestRelease();
    if (current === 'unknown') {
      return { status: 'warn', label: 'simon', detail: `latest is ${version} (local version unknown)` };
    }
    if (compareVersions(version, current) > 0) {
      return { status: 'warn', label: 'simon', detail: `${current} (latest ${version})`, fix: 'simon update' };
    }
    return { status: 'ok', label: 'simon', detail: `${current} (latest)` };
  } catch {
    return { status: 'warn', label: 'simon', detail: `${current} (couldn't reach GitHub to check)` };
  }
}

function icon(s: Status): string {
  return s === 'ok' ? chalk.green('✓') : s === 'warn' ? chalk.yellow('!') : chalk.red('✗');
}

function printCheck(c: Check): void {
  console.log(`  ${icon(c.status)}  ${c.label}${c.detail ? chalk.gray('  ' + c.detail) : ''}`);
  if (c.fix && c.status !== 'ok') console.log(`       ${chalk.gray('→ ' + c.fix)}`);
}

export async function doctorCommand(): Promise<void> {
  const stop = spinner('Checking environment...');
  const version = await versionCheck();
  stop();

  console.log(chalk.bold.blue('\niOS'));
  console.log(chalk.gray('─'.repeat(50)));
  [
    xcodeCheck(),
    xcrunToolCheck('simctl', false),
    xcrunToolCheck('devicectl', true, 'Needs full Xcode (for physical iOS devices)'),
  ].forEach(printCheck);

  console.log(chalk.bold.blue('\nAndroid'));
  console.log(chalk.gray('─'.repeat(50)));
  [androidSdkCheck(), adbCheck(), emulatorCheck()].forEach(printCheck);

  console.log(chalk.bold.blue('\nGeneral'));
  console.log(chalk.gray('─'.repeat(50)));
  [{ status: 'ok', label: 'node', detail: process.version } as Check, version].forEach(printCheck);

  console.log();
}
