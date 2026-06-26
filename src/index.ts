#!/usr/bin/env node
import { Command } from 'commander';
import { launchCommand } from './commands/launch.js';
import { listCommand } from './commands/list.js';
import { runningCommand } from './commands/running.js';
import { stopCommand } from './commands/stop.js';
import { preferCommand } from './commands/prefer.js';
import { createCommand } from './commands/create.js';
import { deleteCommand } from './commands/delete.js';
import { openLinkCommand } from './commands/open-link.js';
import { wipeCommand } from './commands/wipe.js';
import { screenshotCommand } from './commands/screenshot.js';
import { recordCommand } from './commands/record.js';
import { logsCommand } from './commands/logs.js';

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
  .description('Delete a simulator or emulator')
  .option('-i, --ios [name]', 'iOS simulator to delete')
  .option('-a, --android [name]', 'Android emulator to delete')
  .action(deleteCommand);

program
  .command('launch')
  .description('Launch a simulator or emulator')
  .option('-i, --ios [name]', 'iOS simulator to launch (interactive if no name given)')
  .option('-a, --android [name]', 'Android emulator to launch (interactive if no name given)')
  .option('-p, --pick', 'Always show the interactive picker, ignoring preferred')
  .action(launchCommand);

program
  .command('stop')
  .description('Stop a running simulator or emulator')
  .option('-i, --ios [name]', 'iOS simulator to stop (interactive if no name given)')
  .option('-a, --android [name]', 'Android emulator to stop (interactive if no name given)')
  .action(stopCommand);

program
  .command('prefer')
  .description('Set preferred simulator/emulator (used by launch when no name given)')
  .option('-i, --ios', 'Set preferred iOS simulator')
  .option('-a, --android', 'Set preferred Android emulator')
  .action(preferCommand);

program
  .command('open-link <url>')
  .description('Open a deep link on a running simulator or emulator')
  .option('-i, --ios [name]', 'Open on iOS simulator')
  .option('-a, --android [name]', 'Open on Android emulator')
  .action(openLinkCommand);

program
  .command('logs')
  .description('Stream logs from a running simulator or emulator')
  .option('-i, --ios [name]', 'Stream logs from iOS simulator')
  .option('-a, --android [name]', 'Stream logs from Android emulator')
  .option('-f, --filter <expression>', 'Filter expression (predicate for iOS, regex for Android)')
  .action(logsCommand);

program
  .command('record')
  .description('Record the screen of a running simulator or emulator')
  .option('-i, --ios [name]', 'Record from iOS simulator')
  .option('-a, --android [name]', 'Record from Android emulator')
  .option('-o, --output <path>', 'Output file path (default: ~/Desktop/simon_recording_<timestamp>.mp4)')
  .action(recordCommand);

program
  .command('screenshot')
  .description('Take a screenshot of a running simulator or emulator')
  .option('-i, --ios [name]', 'Take screenshot from iOS simulator')
  .option('-a, --android [name]', 'Take screenshot from Android emulator')
  .option('-o, --output <path>', 'Output file path (default: ~/Desktop/simon_screenshot_<timestamp>.png)')
  .action(screenshotCommand);

program
  .command('wipe')
  .description('Wipe all data on a simulator or emulator')
  .option('-i, --ios [name]', 'iOS simulator to wipe')
  .option('-a, --android [name]', 'Android emulator to wipe')
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

process.on('uncaughtException', err => {
  if ((err as NodeJS.ErrnoException).name === 'ExitPromptError') process.exit(0);
  console.error(err);
  process.exit(1);
});

program.parse();
