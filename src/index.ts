#!/usr/bin/env node
import { Command } from 'commander';
import { launchCommand } from './commands/launch.js';
import { listCommand } from './commands/list.js';
import { runningCommand } from './commands/running.js';
import { stopCommand } from './commands/stop.js';
import { preferCommand } from './commands/prefer.js';

const program = new Command();

program
  .name('simon')
  .description('Manage iOS simulators and Android emulators')
  .version('1.0.0');

program
  .command('launch')
  .description('Launch a simulator or emulator')
  .option('-i, --ios [name]', 'iOS simulator to launch (interactive if no name given)')
  .option('-a, --android [name]', 'Android emulator to launch (interactive if no name given)')
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
  .command('list [platform]')
  .description('List simulators/emulators — platform: ios | android (default: both)')
  .action(listCommand);

program
  .command('running')
  .description('Show currently running simulators and emulators')
  .action(runningCommand);

program.parse();
