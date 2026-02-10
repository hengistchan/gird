/**
 * Gird CLI - Command-line interface for MCP Server Manager
 */

import { Command } from 'commander';
import { registerServerCommands } from './commands/server.js';
import { registerKeyCommands } from './commands/key.js';
import { info } from './utils/format.js';

const program = new Command();

program
  .name('gird')
  .description('MCP Server Manager - Deploy and manage MCP servers')
  .version('0.1.0');

// Server commands
registerServerCommands(program);

// API Key commands
registerKeyCommands(program);

// Agent commands
program
  .command('agent')
  .description('Agent management commands')
  .action(() => {
    info('Agent commands coming soon');
  });

// Parse arguments
program.parse();
