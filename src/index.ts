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
  .command('push <payload>')
  .description('Send a push notification to an iOS simulator (payload = JSON/apns file)')
  .option('-i, --ios [name]', 'Target a specific iOS simulator by name')
  .option('-b, --bundle-id <id>', 'App bundle id (if not set in the payload)')
  .action(pushCommand);

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
