/**
 * Server commands
 */

import { Command } from 'commander';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getDb } from '../lib/db.js';
import { formatTable, success, error, info, warn } from '../utils/format.js';
import { getConfig } from '@gird/core';
import chalk from 'chalk';

// Local schema for validation
const ServerTypeSchema = z.enum(['STDIO', 'SSE', 'AWS_LAMBDA', 'EXECUTABLE']);

// Deployment type schema
const DeploymentTypeSchema = z.enum(['LOCAL_PROCESS', 'DOCKER_COMPOSE']);

// Status display helpers
function getStatusBadge(status: string): string {
  switch (status) {
    case 'ACTIVE':
    case 'RUNNING':
      return chalk.green(status);
    case 'STOPPED':
      return chalk.gray(status);
    case 'ERROR':
      return chalk.red(status);
    default:
      return status;
  }
}

type DeploymentWithHealth = {
  id: string;
  type: string;
  status: string;
  port: number | null;
  host: string | null;
  pid: number | null;
  containerId: string | null;
  createdAt: Date;
  updatedAt: Date;
  healthChecks: Array<{
    id: string;
    status: string;
    responseTime: number | null;
    message: string | null;
    checkedAt: Date;
  }>;
};

type ServerWithStatus = {
  id: string;
  name: string;
  type: string;
  status: string;
  description: string | null;
  createdAt: Date;
  deployments?: DeploymentWithHealth[];
};

function formatServerStatus(server: ServerWithStatus): void {
  console.log(`\n${chalk.bold(server.name)} (${server.type})`);
  console.log(`  ID:        ${chalk.dim(server.id)}`);
  console.log(`  Status:    ${getStatusBadge(server.status)}`);
  if (server.description) {
    console.log(`  Desc:      ${server.description}`);
  }

  // Latest deployment
  if (server.deployments && server.deployments.length > 0) {
    const deployment = server.deployments[0];
    if (!deployment) return;

    console.log(`\n  ${chalk.cyan('Deployment:')}`);
    console.log(`    Type:      ${deployment.type}`);
    console.log(`    Status:    ${getStatusBadge(deployment.status)}`);
    if (deployment.port) {
      console.log(`    Endpoint:  ${deployment.host || '127.0.0.1'}:${deployment.port}`);
    }
    if (deployment.pid) {
      console.log(`    PID:       ${deployment.pid}`);
    }
    if (deployment.containerId) {
      console.log(`    Container: ${deployment.containerId.slice(0, 12)}`);
    }
    console.log(`    Updated:   ${deployment.updatedAt.toISOString()}`);

    // Latest health check from deployment
    if (deployment.healthChecks && deployment.healthChecks.length > 0) {
      const health = deployment.healthChecks[0];
      if (!health) return;

      const healthColor = health.status === 'healthy' ? chalk.green : health.status === 'degraded' ? chalk.yellow : chalk.red;
      console.log(`\n  ${chalk.cyan('Health Check:')}`);
      console.log(`    Status:    ${healthColor(health.status)}`);
      if (health.responseTime !== null) {
        console.log(`    Latency:   ${health.responseTime}ms`);
      }
      if (health.message) {
        console.log(`    Message:   ${health.message}`);
      }
      console.log(`    Checked:   ${health.checkedAt.toISOString()}`);
    }
  } else {
    console.log(`\n  ${chalk.dim('No deployments found')}`);
  }

  console.log(''); // Empty line for spacing
}

export function registerServerCommands(program: Command): void {
  const serverCmd = program.command('server').description('Manage MCP servers');

  // List servers
  serverCmd
    .command('list')
    .description('List all servers')
    .action(async () => {
      const prisma = getDb();
      const servers = await prisma.server.findMany({
        orderBy: { createdAt: 'desc' },
      });

      if (servers.length === 0) {
        info('No servers found. Create one with "gird server create"');
        return;
      }

      formatTable(
        ['Name', 'Type', 'Status', 'ID'],
        servers.map((s) => [s.name, s.type, s.status, s.id.slice(0, 8)])
      );
    });

  // Get server details
  serverCmd
    .command('info <name>')
    .description('Get server details')
    .action(async (name: string) => {
      const prisma = getDb();
      const server = await prisma.server.findFirst({
        where: {
          OR: [{ name }, { id: name }],
        },
        include: {
          deployments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!server) {
        error(`Server not found: ${name}`);
        process.exit(1);
      }

      // Format server display
      console.log(`\n${server.name} (${server.type})`);
      console.log(`  ID:        ${server.id}`);
      console.log(`  Status:    ${server.status}`);
      if (server.description) {
        console.log(`  Desc:      ${server.description}`);
      }
      console.log(`  Created:   ${server.createdAt.toISOString()}`);
    });

  // Create server
  serverCmd
    .command('create <name>')
    .description('Create a new server')
    .option('-t, --type <type>', 'Server type (STDIO, SSE, AWS_LAMBDA, EXECUTABLE)', 'STDIO')
    .option('-c, --command <command>', 'Command to run (for STDIO type)')
    .option('--args <args>', 'Command arguments (JSON array)')
    .option('--description <description>', 'Server description')
    .action(async (name: string, options) => {
      // Validate server type
      const typeResult = ServerTypeSchema.safeParse(options.type);
      if (!typeResult.success) {
        error(`Invalid server type: ${options.type}`);
        process.exit(1);
      }

      const prisma = getDb();

      // Check if server already exists
      const existing = await prisma.server.findUnique({
        where: { name },
      });

      if (existing) {
        error(`Server already exists: ${name}`);
        process.exit(1);
      }

      // Build config
      const config: Record<string, unknown> = {};

      if (options.type === 'STDIO' && options.command) {
        config.command = options.command;
        if (options.args) {
          try {
            config.args = JSON.parse(options.args);
          } catch {
            error('Invalid JSON for args');
            process.exit(1);
          }
        }
      }

      const server = await prisma.server.create({
        data: {
          name,
          type: typeResult.data,
          config: config as Prisma.InputJsonValue,
          description: options.description,
        },
      });

      success(`Server created: ${server.name} (${server.id})`);
    });

  // Start server
  serverCmd
    .command('start <name>')
    .description('Start a server deployment')
    .option('-t, --type <type>', 'Deployment type (LOCAL_PROCESS, DOCKER_COMPOSE)', 'LOCAL_PROCESS')
    .action(async (name: string, options) => {
      const prisma = getDb();
      const server = await prisma.server.findFirst({
        where: {
          OR: [{ name }, { id: name }],
        },
      });

      if (!server) {
        error(`Server not found: ${name}`);
        process.exit(1);
      }

      // Validate deployment type
      const deploymentTypeResult = DeploymentTypeSchema.safeParse(options.type);
      if (!deploymentTypeResult.success) {
        error(`Invalid deployment type: ${options.type}`);
        process.exit(1);
      }

      // Create deployment
      const deployment = await prisma.deployment.create({
        data: {
          serverId: server.id,
          type: deploymentTypeResult.data,
          status: 'RUNNING',
          port: 3000 + Math.floor(Math.random() * 1000),
        },
      });

      // Update server status
      await prisma.server.update({
        where: { id: server.id },
        data: { status: 'ACTIVE' },
      });

      success(`Server started: ${server.name} (Deployment: ${deployment.id})`);
    });

  // Stop server
  serverCmd
    .command('stop <name>')
    .description('Stop a server deployment')
    .action(async (name: string) => {
      const prisma = getDb();
      const server = await prisma.server.findFirst({
        where: {
          OR: [{ name }, { id: name }],
        },
      });

      if (!server) {
        error(`Server not found: ${name}`);
        process.exit(1);
      }

      // Find running deployment
      const deployment = await prisma.deployment.findFirst({
        where: {
          serverId: server.id,
          status: 'RUNNING',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!deployment) {
        error('No running deployment found');
        process.exit(1);
      }

      // Update deployment status
      await prisma.deployment.update({
        where: { id: deployment.id },
        data: { status: 'STOPPED' },
      });

      // Update server status
      await prisma.server.update({
        where: { id: server.id },
        data: { status: 'STOPPED' },
      });

      success(`Server stopped: ${server.name}`);
    });

  // Update server
  serverCmd
    .command('update <name>')
    .description('Update a server configuration')
    .option('--new-name <newName>', 'New name for the server')
    .option('--type <type>', 'Server type (STDIO, SSE, AWS_LAMBDA, EXECUTABLE)')
    .option('--command <command>', 'Command for STDIO servers')
    .option('--args <args>', 'Arguments for STDIO/EXECUTABLE servers (JSON array)')
    .option('--url <url>', 'URL for SSE servers')
    .option('--functionName <name>', 'Function name for AWS Lambda servers')
    .option('--region <region>', 'AWS region for Lambda servers')
    .option('--path <path>', 'Path for EXECUTABLE servers')
    .option('--description <text>', 'Server description')
    .action(async (name: string, options) => {
      const prisma = getDb();

      // Find the server
      const server = await prisma.server.findFirst({
        where: {
          OR: [{ name }, { id: name }],
        },
      });

      if (!server) {
        error(`Server not found: ${name}`);
        process.exit(1);
      }

      // Collect all updates
      const updates: Record<string, unknown> = {};
      let configNeedsUpdate = false;

      // Update name if provided
      if (options.newName) {
        updates.name = options.newName;
      }

      // Update description if provided (including empty string to clear)
      if (options.description !== undefined) {
        updates.description = options.description || null;
      }

      // Handle type change and config updates
      let targetType = server.type;
      if (options.type) {
        const typeResult = ServerTypeSchema.safeParse(options.type);
        if (!typeResult.success) {
          error(`Invalid server type: ${options.type}`);
          process.exit(1);
        }
        targetType = typeResult.data;
        updates.type = targetType;
      }

      // Get current config
      const config = (server.config as Prisma.JsonObject) || {};

      // Update config based on server type
      switch (targetType) {
        case 'STDIO':
          if (options.command) {
            config.command = options.command;
            configNeedsUpdate = true;
          }
          if (options.args) {
            try {
              config.args = JSON.parse(options.args);
              configNeedsUpdate = true;
            } catch {
              error('Invalid JSON for args');
              process.exit(1);
            }
          }
          break;

        case 'SSE':
          if (options.url) {
            config.url = options.url;
            configNeedsUpdate = true;
          }
          break;

        case 'AWS_LAMBDA':
          if (options.functionName) {
            config.functionName = options.functionName;
            configNeedsUpdate = true;
          }
          if (options.region) {
            config.region = options.region;
            configNeedsUpdate = true;
          }
          break;

        case 'EXECUTABLE':
          if (options.path) {
            config.path = options.path;
            configNeedsUpdate = true;
          }
          if (options.args) {
            try {
              config.args = JSON.parse(options.args);
              configNeedsUpdate = true;
            } catch {
              error('Invalid JSON for args');
              process.exit(1);
            }
          }
          break;
      }

      if (configNeedsUpdate) {
        updates.config = config as Prisma.InputJsonValue;
      }

      // Check if there's anything to update
      if (Object.keys(updates).length === 0) {
        info('No changes specified. Use options to specify what to update.');
        info('Available options: --new-name, --type, --command, --args, --url, --functionName, --region, --path, --description');
        return;
      }

      // Apply updates
      const updatedServer = await prisma.server.update({
        where: { id: server.id },
        data: updates as Prisma.ServerUpdateInput,
      });

      success(`Server updated: ${updatedServer.name} (${updatedServer.id})`);
    });

  // Delete server
  serverCmd
    .command('delete <name>')
    .description('Delete a server')
    .option('-f, --force', 'Force delete without confirmation')
    .action(async (name: string, options) => {
      const prisma = getDb();
      const server = await prisma.server.findFirst({
        where: {
          OR: [{ name }, { id: name }],
        },
      });

      if (!server) {
        error(`Server not found: ${name}`);
        process.exit(1);
      }

      if (!options.force) {
        error('Delete requires --force flag. Be careful!');
        process.exit(1);
      }

      await prisma.server.delete({
        where: { id: server.id },
      });

      success(`Server deleted: ${server.name}`);
    });

  // View server logs
  serverCmd
    .command('logs <name>')
    .description('View server logs')
    .option('-f, --follow', 'Follow log output (like tail -f)')
    .option('-n, --tail <lines>', 'Number of lines to show', '100')
    .action(async (name: string, options) => {
      const prisma = getDb();
      const server = await prisma.server.findFirst({
        where: {
          OR: [{ name }, { id: name }],
        },
      });

      if (!server) {
        error(`Server not found: ${name}`);
        process.exit(1);
      }

      // Check if server is running
      const deployment = await prisma.deployment.findFirst({
        where: {
          serverId: server.id,
          status: 'RUNNING',
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!deployment) {
        warn(`No running deployment found for server: ${name}`);
        info('Start the server first with "gird server start <name>"');
        process.exit(1);
      }

      // Get API server configuration
      const config = getConfig();
      const apiUrl = `http://${config.api.host}:${config.api.port}`;
      const tail = options.tail ?? '100';

      // Function to fetch logs from API
      const fetchLogs = async (): Promise<string | null> => {
        try {
          const response = await fetch(`${apiUrl}/api/servers/${server.id}/logs?tail=${tail}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
            if (response.status === 404 || errorData.error) {
              return null;
            }
            throw new Error(`API error: ${response.status} ${response.statusText}`);
          }

          const data = await response.json() as { success: boolean; logs: string; tail: number };
          return data.logs || '';
        } catch {
          // Network errors or API not running
          return null;
        }
      };

      // Format and display logs
      let displayedLogs = '';

      const displayLogs = (logs: string) => {
        if (logs === displayedLogs) {
          return;
        }

        const newLogs = logs.slice(displayedLogs.length);
        if (newLogs) {
          // Split by lines and format each line with timestamp if not already formatted
          const lines = newLogs.split('\n').filter((line) => line.trim());

          for (const line of lines) {
            // Check if line already has a timestamp format [YYYY-MM-DD HH:MM:SS]
            if (!line.match(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\]/)) {
              // Add timestamp if not present
              const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
              console.log(`[${timestamp}] ${line}`);
            } else {
              console.log(line);
            }
          }

          displayedLogs = logs;
        }
      };

      if (options.follow) {
        // Follow mode: poll every second for new logs
        info(`Following logs for server: ${name} (Ctrl+C to exit)`);
        console.log('');

        let consecutiveErrors = 0;
        const maxErrors = 5;

        const pollInterval = setInterval(async () => {
          const logs = await fetchLogs();

          if (logs === null) {
            consecutiveErrors++;
            if (consecutiveErrors >= maxErrors) {
              clearInterval(pollInterval);
              error('Failed to fetch logs from API server');
              info('Make sure the API server is running on ' + apiUrl);
              process.exit(1);
            }
            return;
          }

          consecutiveErrors = 0;
          displayLogs(logs);
        }, 1000);

        // Handle Ctrl+C
        process.on('SIGINT', () => {
          clearInterval(pollInterval);
          console.log('\n');
          info('Stopped following logs');
          process.exit(0);
        });

        // Initial fetch
        const initialLogs = await fetchLogs();
        if (initialLogs !== null) {
          displayLogs(initialLogs);
        } else {
          warn('No logs available yet. Waiting for server to start...');
        }
      } else {
        // Single fetch mode
        const logs = await fetchLogs();

        if (logs === null) {
          error('Failed to fetch logs from API server');
          info('Make sure the API server is running on ' + apiUrl);
          process.exit(1);
        }

        if (!logs) {
          info('No logs available for this server');
          return;
        }

        console.log(`\nLogs for ${name}:`);
        console.log('');

        const lines = logs.split('\n').filter((line) => line.trim());
        for (const line of lines) {
          // Check if line already has a timestamp format
          if (!line.match(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\]/)) {
            const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
            console.log(`[${timestamp}] ${line}`);
          } else {
            console.log(line);
          }
        }

        if (lines.length === 0) {
          info('No log entries found');
        }
      }
    });

  // Server status command
  serverCmd
    .command('status [name]')
    .description('Show server deployment status (all servers or specific server)')
    .action(async (name?: string) => {
      const prisma = getDb();

      if (name) {
        // Show specific server status
        const server = await prisma.server.findFirst({
          where: {
            OR: [{ name }, { id: name }],
          },
          include: {
            deployments: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
              include: {
                healthChecks: {
                  orderBy: { checkedAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });

        if (!server) {
          error(`Server not found: ${name}`);
          process.exit(1);
        }

        formatServerStatus(server);
      } else {
        // Show all servers status
        const servers = await prisma.server.findMany({
          include: {
            deployments: {
              orderBy: { updatedAt: 'desc' },
              take: 1,
              include: {
                healthChecks: {
                  orderBy: { checkedAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
          orderBy: { name: 'asc' },
        });

        if (servers.length === 0) {
          info('No servers found. Create one with "gird server create"');
          return;
        }

        console.log(`\n${chalk.bold('Server Status Summary')}\n`);

        formatTable(
          ['Name', 'Type', 'Status', 'Deployment', 'Health'],
          servers.map((s) => [
            s.name,
            s.type,
            getStatusBadge(s.status),
            s.deployments?.[0]?.status ? getStatusBadge(s.deployments[0].status) : chalk.dim('N/A'),
            s.deployments?.[0]?.healthChecks?.[0]
              ? (s.deployments[0].healthChecks[0].status === 'healthy'
                ? chalk.green(s.deployments[0].healthChecks[0].status)
                : s.deployments[0].healthChecks[0].status === 'degraded'
                  ? chalk.yellow(s.deployments[0].healthChecks[0].status)
                  : chalk.red(s.deployments[0].healthChecks[0].status))
              : chalk.dim('N/A'),
          ])
        );

        // Show counts
        const activeCount = servers.filter((s) => s.status === 'ACTIVE').length;
        const stoppedCount = servers.filter((s) => s.status === 'STOPPED').length;
        const errorCount = servers.filter((s) => s.status === 'ERROR').length;

        console.log(`\n${chalk.cyan('Summary:')}`);
        console.log(`  Total:    ${servers.length}`);
        console.log(`  Active:   ${chalk.green(activeCount)}`);
        console.log(`  Stopped:  ${chalk.gray(stoppedCount)}`);
        console.log(`  Error:    ${chalk.red(errorCount)}\n`);
      }
    });
}
