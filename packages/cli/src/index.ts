/**
 * Gird CLI - Command-line interface for MCP Server Manager
 */

import { Command } from 'commander';
import { registerServerCommands } from './commands/server.js';
import { registerKeyCommands } from './commands/key.js';
import { info, success, error } from './utils/format.js';
import { closeDb, getDb } from './lib/db.js';
import { getConfig } from '@gird/core';
import chalk from 'chalk';

const program = new Command();

program
  .name('gird')
  .description('MCP Server Manager - Deploy and manage MCP servers')
  .version('0.1.0');

// Server commands
registerServerCommands(program);

// API Key commands
registerKeyCommands(program);

// System status command
program
  .command('status')
  .description('Show overall system status')
  .action(async () => {
    const config = getConfig();
    const prisma = getDb();

    console.log(`\n${chalk.bold('Gird System Status')}\n`);

    // API Server status
    console.log(`${chalk.cyan('API Server:')}`);
    try {
      const apiUrl = `http://${config.api.host}:${config.api.port}`;
      const response = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (response.ok) {
        success(`Running on ${config.api.host}:${config.api.port}`);
      } else {
        error(`Responded with status ${response.status}`);
      }
    } catch {
      error(`Not reachable on ${config.api.host}:${config.api.port}`);
    }

    // Agent Server status
    console.log(`\n${chalk.cyan('Agent Server:')}`);
    try {
      const agentUrl = `http://${config.agent.host}:${config.agent.port}`;
      const response = await fetch(`${agentUrl}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        success(`Running on ${config.agent.host}:${config.agent.port}`);
      } else {
        error(`Responded with status ${response.status}`);
      }
    } catch {
      error(`Not reachable on ${config.agent.host}:${config.agent.port}`);
    }

    // Database status
    console.log(`\n${chalk.cyan('Database:')}`);
    try {
      await prisma.$queryRaw`SELECT 1`;
      success('Connected');
    } catch {
      error('Connection failed');
    }

    // Servers summary
    console.log(`\n${chalk.cyan('Servers:')}`);
    try {
      const servers = await prisma.server.findMany();
      const activeCount = servers.filter((s) => s.status === 'ACTIVE').length;
      const stoppedCount = servers.filter((s) => s.status === 'STOPPED').length;
      const errorCount = servers.filter((s) => s.status === 'ERROR').length;

      console.log(`  Total:    ${servers.length}`);
      console.log(`  Active:   ${chalk.green(activeCount)}`);
      console.log(`  Stopped:  ${chalk.gray(stoppedCount)}`);
      console.log(`  Error:    ${chalk.red(errorCount)}`);
    } catch {
      error('Failed to query servers');
    }

    // Deployments summary
    console.log(`\n${chalk.cyan('Deployments:')}`);
    try {
      const deployments = await prisma.deployment.findMany();
      const runningCount = deployments.filter((d) => d.status === 'RUNNING').length;
      const stoppedCount = deployments.filter((d) => d.status === 'STOPPED').length;
      const errorCount = deployments.filter((d) => d.status === 'ERROR').length;

      console.log(`  Total:    ${deployments.length}`);
      console.log(`  Running:  ${chalk.green(runningCount)}`);
      console.log(`  Stopped:  ${chalk.gray(stoppedCount)}`);
      console.log(`  Error:    ${chalk.red(errorCount)}`);
    } catch {
      error('Failed to query deployments');
    }

    console.log('');
  });

// Agent commands
program
  .command('agent')
  .description('Agent management commands')
  .action(() => {
    info('Agent commands coming soon');
  });

// Setup shutdown handlers for proper database connection cleanup
const handleShutdown = async (_signal: string, exitCode: number = 0): Promise<never> => {
  await closeDb();
  process.exit(exitCode);
};

// Handle exit event (synchronous, cannot use async)
process.on('exit', () => {
  // closeDb is async but we can't await in 'exit' handler
  // The connection will be closed when the process ends
  void closeDb();
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => void handleShutdown('SIGINT', 0));

// Handle SIGTERM
process.on('SIGTERM', () => void handleShutdown('SIGTERM', 0));

// Parse arguments
program.parse();
