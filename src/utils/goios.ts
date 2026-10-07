import chalk from 'chalk';
import { execSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { spinner } from './prompt.js';

export const TUNNEL_LOG = path.join(tmpdir(), 'simon-ios-tunnel.log');

export function hasGoIos(): boolean {
  try {
    execSync('command -v ios', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// go-ios isn't a first-party tool, so install it on demand the first time a
// physical-iOS command needs it (the user asked for this to be automatic).
export function ensureGoIos(): void {
  if (hasGoIos()) return;

  const stop = spinner('go-ios not found — installing (npm install -g go-ios)...');
  try {
    execSync('npm install -g go-ios', { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    stop();
    const last = (e as { stderr?: Buffer }).stderr?.toString().trim().split('\n').pop() ?? '';
    throw new Error(
      'go-ios is required for physical iOS devices and the automatic install failed.\n' +
        (last ? `${last}\n` : '') +
        'Install it manually:  npm install -g go-ios',
    );
  }
  stop();

  if (!hasGoIos()) {
    throw new Error("go-ios installed but `ios` isn't on your PATH — check your npm global bin directory is on PATH.");
  }
}

export function tunnelRunning(): boolean {
  try {
    execSync('pgrep -f "ios tunnel start"', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// iOS 17+ needs a root developer tunnel running. Start it detached so it
// survives after simon exits; sudo is prompted once via the terminal.
export function ensureTunnel(): void {
  if (tunnelRunning()) return;

  console.log(chalk.gray('Starting the iOS developer tunnel (sudo required; needed on iOS 17+)...'));
  try {
    execSync('sudo -v', { stdio: 'inherit' });
  } catch {
    throw new Error('Could not get sudo to start the developer tunnel. Start it manually:  sudo ios tunnel start');
  }

  // Launch via the shell with `nohup … &`, inheriting the terminal. macOS sudo
  // ties its credential timestamp to the tty, so it must keep the real
  // controlling terminal (a `detached`/setsid process loses it and re-prompts
  // with nowhere to read a password — which is why it never started). nohup + &
  // lets it outlive simon; output goes to a log file.
  try {
    execSync(`nohup sudo ios tunnel start > "${TUNNEL_LOG}" 2>&1 &`, { stdio: 'inherit' });
  } catch {
    /* the backgrounded job returns immediately; real errors surface in the log */
  }

  // First run can take a few seconds (it mounts the developer image). Poll.
  for (let i = 0; i < 24; i++) {
    if (tunnelRunning()) {
      try {
        execSync('sleep 2'); // small grace for the tunnel to finish establishing
      } catch {
        /* ignore */
      }
      console.log(chalk.gray(`Tunnel started (logs: ${TUNNEL_LOG}).`));
      return;
    }
    try {
      execSync('sleep 0.5');
    } catch {
      /* ignore */
    }
  }

  throw new Error(
    `The developer tunnel did not start. Check ${TUNNEL_LOG}, or run it manually:  sudo ios tunnel start`,
  );
}

export function stopTunnel(): boolean {
  if (!tunnelRunning()) return false;
  execSync('sudo pkill -f "ios tunnel start"', { stdio: 'inherit' });
  return true;
}
