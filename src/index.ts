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
  .command('delete')
  .description('Delete a simulator or emulator (picks from a list if no flag given)')
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .action(deleteCommand);

program
  .command('launch')
  .description('Launch a simulator or emulator (picks from a list if no flag given)')
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .action(launchCommand);

program
  .command('stop')
  .description('Stop a running simulator or emulator (picks from a list if no flag given)')
  .option('-i, --ios [name]', 'Limit to iOS (optionally name a simulator)')
  .option('-a, --android [name]', 'Limit to Android (optionally name an emulator)')
  .action(stopCommand);

program
  .command('open-link <url>')
  .description('Open a deep link on a running simulator, emulator, or physical device')
  .option('-i, --ios [name]', 'Open on iOS simulator or device')
  .option('-a, --android [name]', 'Open on Android emulator or device')
  .option('-b, --bundle-id <id>', 'Deliver directly to this app instead of routing via Safari (physical iOS only)')
  .option('-r, --restart', 'Cold-relaunch the app instead of warm-foregrounding it (physical iOS only)')
  .action(openLinkCommand);

program
  .command('logs')
  .description('Stream logs from a running simulator or emulator')
  .option('-i, --ios [name]', 'Stream logs from iOS simulator')
  .option('-a, --android [name]', 'Stream logs from Android emulator')
  .option('-f, --filter <expression>', 'Filter expression (predicate for iOS, regex for Android)')
  .action(logsCommand);

program
  .command('wipe')
  .description('Wipe all data on a simulator or emulator (picks from a list if no flag given)')
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
  .command('location [coords]')
  .description('Set a simulated GPS location (coords as "lat,lon") on a simulator, emulator, or physical iOS device')
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
  .action(checkUpdateCommand);

program
  .command('update')
  .description('Update simon to the latest version')
  .action(updateCommand);

process.on('uncaughtException', err => {
  if ((err as NodeJS.ErrnoException).name === 'ExitPromptError') process.exit(0);
  console.error(err);
  process.exit(1);
});

program.parse();
