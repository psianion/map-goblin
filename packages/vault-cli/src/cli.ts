#!/usr/bin/env node
import { Command } from 'commander';
import { validateCommand } from './commands/validate.js';
import { buildCommand } from './commands/build.js';
import { composeCommand } from './commands/compose.js';
import { indexCommand } from './commands/index-cmd.js';
import { forgeCommand } from './commands/forge.js';

const program = new Command();

program
  .name('pack-builder')
  .description('Map Assets build pipeline CLI')
  .version('0.1.0');

program.addCommand(validateCommand());
program.addCommand(buildCommand());
program.addCommand(composeCommand());
program.addCommand(indexCommand());
program.addCommand(forgeCommand());

program.parse();
