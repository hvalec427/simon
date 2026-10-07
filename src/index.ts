#!/usr/bin/env node
import { Command } from 'commander';
import { launchCommand } from './commands/launch.js';
import { listCommand } from './commands/list.js';
import { runningCommand } from './commands/running.js';
import { stopCommand } from './commands/stop.js';
import { createCommand } from './commands/create.js';
import { deleteCommand } from './commands/delete.js';
import { openLinkCommand } from './commands/open-link.js';
import { wipeCommand } from './commands/wipe.js';
import { logsCommand } from './commands/logs.js';
import { checkUpdateCommand } from './commands/check-update.js';
import { updateCommand } from './commands/update.js';
import { doctorCommand } from './commands/doctor.js';
import { pushCommand } from './commands/push.js';
import { locationCommand } from './commands/location.js';
import { tunnelCommand } from './commands/tunnel.js';

const program = new Command();

program
  .name('simon')
  .description('Manage iOS simulators and Android emulators')
  .version(process.env.npm_package_version ?? 'unknown', '-v, --version');

program
  .command('create')
  .description('Create a new simulator or emulator')
  .option('-i, --ios', 'Create an iOS simulator')
  .option('-a, --android', 'Create an Android emulator')
  .action(createCommand);

program
  .command('delete [name]')
  .description('Delete a simulator or emulator (picks from a list if no flag/name given)')
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .action(deleteCommand);

program
  .command('launch [name]')
  .description('Launch a simulator or emulator (picks from a list if no flag/name given)')
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .action(launchCommand);

program
  .command('stop [name]')
  .description('Stop a running simulator or emulator (picks from a list if no flag/name given)')
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .action(stopCommand);

program
  .command('open-link <url> [name]')
  .description('Open a deep link on a running simulator, emulator, or physical device')
  .option('-i, --ios [name]', 'Open on iOS simulator or device')
  .option('-a, --android [name]', 'Open on Android emulator or device')
  .option('-b, --bundle-id <id>', 'Deliver directly to this app instead of routing via Safari (physical iOS only)')
  .option('-r, --restart', 'Cold-relaunch the app instead of warm-foregrounding it (physical iOS only)')
  .action(openLinkCommand);

program
  .command('logs [name]')
  .description('Stream logs from a running simulator, emulator, or physical device')
  .option('-i, --ios [name]', 'Stream logs from iOS simulator or device')
  .option('-a, --android [name]', 'Stream logs from Android emulator or device')
  .option('-f, --filter <expression>', 'Filter expression (predicate for iOS, regex for Android)')
  .option('--app <name>', 'Show only this app\'s logs (process/app name; bundle id also works on iOS simulators)')
  .option('--rn', 'Stream React Native JS console + network from Metro (CDP), not device logs')
  .option('--port <port>', 'Metro port for --rn (default 8081)')
  .option('--print-ws', 'Print the Metro inspector WebSocket URL(s) for --rn targets and exit (e.g. for nvim-dap)')
  .action(logsCommand);

program
  .command('wipe [name]')
  .description('Wipe all data on a simulator or emulator (picks from a list if no flag/name given)')
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .action(wipeCommand);

program
  .command('list')
  .description('List simulators/emulators (default: both)')
  .option('-i, --ios', 'List iOS simulators')
  .option('-a, --android', 'List Android emulators')
  .action(listCommand);

program
  .command('running')
  .description('Show currently running simulators and emulators')
  .action(runningCommand);

program
  .command('location [coords] [name]')
  .description('Set a simulated GPS location (coords as "lat,lon") on a simulator, emulator, or physical iOS device')
  // Negative latitudes (e.g. -19.8,29.7) look like options to the parser; tolerate
  // them instead of erroring — the command recovers the coords from argv itself.
  .allowUnknownOption()
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .option('-r, --reset', 'Clear the simulated location (iOS simulators)')
  .action(locationCommand);

program
  .command('push [payload]')
  .description('Send a push to an iOS simulator, or to a real device via --token (FCM/APNs)')
  .option('-i, --ios [name]', 'Target a specific iOS simulator by name')
  .option('-b, --bundle-id <id>', 'App bundle id (simulator; if not set in the payload)')
  .option('-t, --template', 'Print an example payload (use with --fcm for the FCM shape)')
  .option('--token <token>', 'Send to a real device with this push token (uses ~/.config/simon/push.json)')
  .option('--fcm', 'Use FCM (select transport, or pick the FCM template)')
  .option('--apns', 'Use APNs (select transport)')
  .action(pushCommand);

program
  .command('tunnel [action]')
  .description('Manage the iOS developer tunnel for physical-device commands (start | stop | status)')
  .action(tunnelCommand);

program
  .command('doctor')
  .description('Check your environment for simulator/emulator tooling')
  .action(doctorCommand);

program
  .command('check-update')
  .description('Check whether a newer version of simon is available')
  .option('--nightly', 'Check the nightly (develop) channel')
  .option('--stable', 'Check the stable (master) channel')
  .option('--dev', 'Check the dev channel (rolling build from every develop commit)')
  .action(checkUpdateCommand);

program
  .command('update')
  .description('Update simon to the latest version (remembers --stable/--nightly channel)')
  .option('--nightly', 'Switch to and update from the nightly (develop) channel')
  .option('--stable', 'Switch to and update from the stable (master) channel')
  .option('--dev', 'Switch to and update from the dev channel (rolling build from every develop commit)')
  .option('--force', 'Install the channel\'s latest even if it is the same or an older version')
  .action(updateCommand);

process.on('uncaughtException', err => {
  if ((err as NodeJS.ErrnoException).name === 'ExitPromptError') process.exit(0);
  console.error(err);
  process.exit(1);
});

program.parse();
