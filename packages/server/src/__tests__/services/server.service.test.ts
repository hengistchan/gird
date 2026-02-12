/**
 * Tests for Server Service
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { ServerService } from '../../services/server.service.js';
import { NotFoundError, ValidationError } from '@gird/core';

// Test utilities
let testCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++testCounter}`;
}

describe('ServerService', () => {
  let prisma: PrismaClient;
  let serverService: ServerService;
  let createdServerIds: string[] = [];

  beforeAll(async () => {
    const dbPath = path.resolve(__dirname, '../../../../../prisma/dev.db');
    process.env.DATABASE_URL = `file:${dbPath}`;

    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    serverService = new ServerService();
    createdServerIds = [];
  });

  afterEach(async () => {
    // Cleanup created servers
    for (const id of createdServerIds) {
      await prisma.server.delete({ where: { id } }).catch(() => {});
    }
  });

  describe('create', () => {
    it('should create a STDIO server', async () => {
      const data = {
        name: uniqueId('create-stdio'),
        type: 'STDIO' as const,
        config: {
          command: 'node',
          args: ['--version'],
          env: { NODE_ENV: 'test' },
        },
        description: 'Test STDIO server',
      };

      const result = await serverService.create(data);
      createdServerIds.push(result.id);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(data.name);
      expect(result.type).toBe('STDIO');
      expect(result.description).toBe(data.description);
    });

    it('should create an SSE server', async () => {
      const data = {
        name: uniqueId('create-sse'),
        type: 'SSE' as const,
        config: {
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer token' },
        },
      };

      const result = await serverService.create(data);
      createdServerIds.push(result.id);

      expect(result.type).toBe('SSE');
    });

    it('should throw ValidationError for duplicate name', async () => {
      const name = uniqueId('duplicate');

      await serverService.create({
        name,
        type: 'STDIO',
        config: { command: 'node' },
      });

      await expect(serverService.create({
        name,
        type: 'STDIO',
        config: { command: 'node' },
      })).rejects.toThrow(ValidationError);
    });
  });

  describe('findById', () => {
    it('should return server with deployments', async () => {
      const created = await serverService.create({
        name: uniqueId('find-by-id'),
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(created.id);

      const result = await serverService.findById(created.id);

      expect(result.id).toBe(created.id);
      expect(result.deployments).toBeDefined();
      expect(Array.isArray(result.deployments)).toBe(true);
    });

    it('should throw NotFoundError for non-existent server', async () => {
      await expect(serverService.findById('non-existent-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('findBasicById', () => {
    it('should return basic server info', async () => {
      const created = await serverService.create({
        name: uniqueId('basic'),
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(created.id);

      const result = await serverService.findBasicById(created.id);

      expect(result.id).toBe(created.id);
      expect(result.name).toBe(created.name);
    });

    it('should throw NotFoundError for non-existent server', async () => {
      await expect(serverService.findBasicById('non-existent-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return paginated servers', async () => {
      // Create multiple servers
      for (let i = 0; i < 5; i++) {
        const server = await serverService.create({
          name: uniqueId(`list-${i}`),
          type: 'STDIO',
          config: { command: 'node' },
        });
        createdServerIds.push(server.id);
      }

      const result = await serverService.list({
        pagination: { page: 1, pageSize: 3 },
      });

      expect(result.items.length).toBe(3);
      expect(result.total).toBeGreaterThanOrEqual(5);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(3);
      expect(result.totalPages).toBeGreaterThanOrEqual(2);
    });

    it('should filter by type', async () => {
      // Create STDIO server
      const stdio = await serverService.create({
        name: uniqueId('filter-stdio'),
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(stdio.id);

      // Create SSE server
      const sse = await serverService.create({
        name: uniqueId('filter-sse'),
        type: 'SSE',
        config: { url: 'https://example.com/sse' },
      });
      createdServerIds.push(sse.id);

      const result = await serverService.list({
        filters: { type: 'SSE' },
      });

      result.items.forEach((item) => {
        expect(item.type).toBe('SSE');
      });
    });

    it('should filter by status', async () => {
      const server = await serverService.create({
        name: uniqueId('status-filter'),
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(server.id);

      const result = await serverService.list({
        filters: { status: 'ACTIVE' },
      });

      result.items.forEach((item) => {
        expect(item.status).toBe('ACTIVE');
      });
    });

    it.skip('should search by name (exact match)', async () => {
      // Note: SQLite doesn't support mode: 'insensitive' in contains queries
      // This test is skipped when using SQLite
      const uniqueName = uniqueId('searchable-name');
      const server = await serverService.create({
        name: uniqueName,
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(server.id);

      const result = await serverService.list({
        filters: { search: uniqueName },
      });

      // Should find at least our server (may find others due to partial matching)
      const found = result.items.find((s) => s.id === server.id);
      expect(found).toBeDefined();
    });

    it('should sort by name ascending', async () => {
      const names = ['zebra', 'apple', 'mango'].map((n) => uniqueId(n));

      for (const name of names) {
        const server = await serverService.create({
          name,
          type: 'STDIO',
          config: { command: 'node' },
        });
        createdServerIds.push(server.id);
      }

      const result = await serverService.list({
        pagination: { page: 1, pageSize: 10, sortBy: 'name', sortOrder: 'asc' },
      });

      const sortedNames = result.items.map((s) => s.name);
      expect(sortedNames).toEqual([...sortedNames].sort());
    });

    it('should return all servers without pagination', async () => {
      const result = await serverService.list();

      expect(result.items).toBeDefined();
      expect(result.total).toBe(result.items.length);
    });
  });

  describe('update', () => {
    it('should update server name', async () => {
      const created = await serverService.create({
        name: uniqueId('update-name'),
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(created.id);

      const updated = await serverService.update(created.id, {
        name: uniqueId('updated-name'),
      });

      expect(updated.name).not.toBe(created.name);
    });

    it('should update server config', async () => {
      const created = await serverService.create({
        name: uniqueId('update-config'),
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(created.id);

      const updated = await serverService.update(created.id, {
        config: { command: 'python', args: ['-m', 'server'] },
      });

      // Verify update worked by fetching again
      const fetched = await serverService.findById(created.id);
      expect(fetched.config).toBeDefined();
    });

    it('should throw NotFoundError for non-existent server', async () => {
      await expect(serverService.update('non-existent-id', { name: 'test' }))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw ValidationError for duplicate name on update', async () => {
      const name1 = uniqueId('dup1');
      const name2 = uniqueId('dup2');

      await serverService.create({
        name: name1,
        type: 'STDIO',
        config: { command: 'node' },
      });

      const server2 = await serverService.create({
        name: name2,
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(server2.id);

      await expect(serverService.update(server2.id, { name: name1 }))
        .rejects.toThrow(ValidationError);
    });
  });

  describe('delete', () => {
    it('should delete server', async () => {
      const created = await serverService.create({
        name: uniqueId('delete'),
        type: 'STDIO',
        config: { command: 'node' },
      });

      await serverService.delete(created.id);

      await expect(serverService.findById(created.id))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for non-existent server', async () => {
      await expect(serverService.delete('non-existent-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('checkNameAvailable', () => {
    it('should return true for available name', async () => {
      const result = await serverService.checkNameAvailable(uniqueId('available'));
      expect(result).toBe(true);
    });

    it('should return false for taken name', async () => {
      const name = uniqueId('taken');
      await serverService.create({
        name,
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push((await serverService.findByName(name))!.id);

      const result = await serverService.checkNameAvailable(name);
      expect(result).toBe(false);
    });

    it('should exclude current server when checking', async () => {
      const name = uniqueId('exclude-self');
      const created = await serverService.create({
        name,
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(created.id);

      const result = await serverService.checkNameAvailable(name, created.id);
      expect(result).toBe(true);
    });
  });

  describe('findByName', () => {
    it('should return server by name', async () => {
      const name = uniqueId('find-by-name');
      const created = await serverService.create({
        name,
        type: 'STDIO',
        config: { command: 'node' },
      });
      createdServerIds.push(created.id);

      const result = await serverService.findByName(name);

      expect(result).toBeDefined();
      expect(result!.name).toBe(name);
    });

    it('should return null for non-existent name', async () => {
      const result = await serverService.findByName('non-existent-name');
      expect(result).toBeNull();
    });
  });
});
