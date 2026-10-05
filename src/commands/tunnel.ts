import chalk from 'chalk';
import { ensureGoIos, ensureTunnel, stopTunnel, tunnelRunning } from '../utils/goios.js';

export async function tunnelCommand(action: string | undefined): Promise<void> {
  const act = action ?? 'status';
  try {
    if (act === 'status') {
      console.log(
        tunnelRunning()
          ? chalk.green('iOS developer tunnel: running')
          : chalk.gray('iOS developer tunnel: not running'),
      );
    } else if (act === 'start') {
      ensureGoIos();
      if (tunnelRunning()) {
        console.log(chalk.green('Tunnel already running.'));
        return;
      }
      ensureTunnel();
      console.log(chalk.green('Tunnel started.'));
    } else if (act === 'stop') {
      console.log(stopTunnel() ? chalk.green('Tunnel stopped.') : chalk.gray('No tunnel was running.'));
    } else {
      console.error(chalk.red(`Unknown action "${act}". Use: start, stop, or status.`));
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
