/**
 * API Key commands
 */

import { Command } from 'commander';
import type { Prisma } from '@prisma/client';
import { generateApiKey, hashApiKey, extractApiKeyPrefix, asApiKeyPermissions } from '@gird/core';
import { getDb } from '../lib/db.js';
import { formatTable, formatApiKey, success, error } from '../utils/format.js';

export function registerKeyCommands(program: Command): void {
  const keyCmd = program.command('key').description('Manage API keys');

  // List API keys
  keyCmd
    .command('list')
    .description('List all API keys')
    .action(async () => {
      const prisma = getDb();
      const keys = await prisma.apiKey.findMany({
        orderBy: { createdAt: 'desc' },
      });

      if (keys.length === 0) {
        console.log('No API keys found. Create one with "gird key create"');
        return;
      }

      formatTable(
        ['Name', 'Permissions', 'ID'],
        keys.map((k) => [
          k.name,
          JSON.stringify(k.permissions),
          k.id.slice(0, 8),
        ])
      );
    });

  // Get API key details
  keyCmd
    .command('info <id>')
    .description('Get API key details')
    .action(async (id: string) => {
      const prisma = getDb();
      const key = await prisma.apiKey.findFirst({
        where: {
          OR: [{ name: id }, { id }],
        },
      });

      if (!key) {
        error(`API key not found: ${id}`);
        process.exit(1);
      }

      // Use type guard to validate permissions
      const permissions = asApiKeyPermissions(key.permissions);

      formatApiKey({
        id: key.id,
        name: key.name,
        permissions,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
      });
    });

  // Create API key
  keyCmd
    .command('create <name>')
    .description('Create a new API key')
    .option('--servers <servers>', 'Allowed server IDs (comma-separated, or "all")')
    .action(async (name: string, options) => {
      const prisma = getDb();

      // Check if key already exists
      const existing = await prisma.apiKey.findFirst({
        where: { name },
      });

      if (existing) {
        error(`API key already exists: ${name}`);
        process.exit(1);
      }

      // Parse permissions
      let permissions: Record<string, unknown>;
      if (options.servers === 'all' || !options.servers) {
        permissions = { serverIds: null };
      } else {
        permissions = {
          serverIds: options.servers.split(',').map((s: string) => s.trim()),
        };
      }

      // Generate the actual API key
      const apiKey = generateApiKey();
      const keyHash = await hashApiKey(apiKey);
      const keyPrefix = extractApiKeyPrefix(apiKey);

      const key = await prisma.apiKey.create({
        data: {
          name,
          key: apiKey,
          keyPrefix,
          keyHash,
          permissions: asApiKeyPermissions(permissions) as Prisma.InputJsonValue,
        },
      });

      success(`API key created: ${key.name}`);
      console.log(`\n  Your API key: ${apiKey}`);
      console.log(`  Keep this secret! You won't see it again.\n`);
    });

  // Delete API key
  keyCmd
    .command('delete <id>')
    .description('Delete an API key')
    .option('-f, --force', 'Force delete without confirmation')
    .action(async (id: string, options) => {
      const prisma = getDb();
      const key = await prisma.apiKey.findFirst({
        where: {
          OR: [{ name: id }, { id }],
        },
      });

      if (!key) {
        error(`API key not found: ${id}`);
        process.exit(1);
      }

      if (!options.force) {
        error('Delete requires --force flag. Be careful!');
        process.exit(1);
      }

      await prisma.apiKey.delete({
        where: { id: key.id },
      });

      success(`API key deleted: ${key.name}`);
    });
}
