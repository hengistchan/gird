/**
 * Server commands
 */

import { Command } from 'commander';
import { PrismaClient, type Prisma } from '@prisma/client';
import { z } from 'zod';
import { formatTable, success, error, info } from '../utils/format.js';

const prisma = new PrismaClient();

// Local schema for validation
const ServerTypeSchema = z.enum(['STDIO', 'SSE', 'AWS_LAMBDA', 'EXECUTABLE']);

// Deployment type schema
const DeploymentTypeSchema = z.enum(['LOCAL_PROCESS', 'DOCKER_COMPOSE']);

export function registerServerCommands(program: Command): void {
  const serverCmd = program.command('server').description('Manage MCP servers');

  // List servers
  serverCmd
    .command('list')
    .description('List all servers')
    .action(async () => {
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

  // Delete server
  serverCmd
    .command('delete <name>')
    .description('Delete a server')
    .option('-f, --force', 'Force delete without confirmation')
    .action(async (name: string, options) => {
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
}
