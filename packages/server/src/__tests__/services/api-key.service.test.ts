/**
 * Tests for API Key Service
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { ApiKeyService } from '../../services/api-key.service.js';
import { NotFoundError } from '@gird-mcp/core';

// Test utilities
let testCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++testCounter}`;
}

describe('ApiKeyService', () => {
  let prisma: PrismaClient;
  let apiKeyService: ApiKeyService;
  let createdKeyIds: string[] = [];

  beforeAll(async () => {
    const dbPath = path.resolve(__dirname, '../../../../../prisma/dev.db');
    process.env.DATABASE_URL = `file:${dbPath}`;

    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(() => {
    apiKeyService = new ApiKeyService();
    createdKeyIds = [];
  });

  afterEach(async () => {
    // Cleanup created keys
    for (const id of createdKeyIds) {
      await prisma.apiKey.delete({ where: { id } }).catch(() => {});
    }
  });

  describe('create', () => {
    it('should create an API key with full access', async () => {
      const data = {
        name: uniqueId('create-full'),
        permissions: { serverIds: null },
      };

      const result = await apiKeyService.create(data);
      createdKeyIds.push(result.id);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(data.name);
      expect(result.key).toBeDefined();
      expect(result.key).toMatch(/^gird_sk_/);
      expect(result.permissions.serverIds).toBeNull();
    });

    it('should create an API key with restricted access', async () => {
      const data = {
        name: uniqueId('create-restricted'),
        permissions: { serverIds: ['server-1', 'server-2'] },
      };

      const result = await apiKeyService.create(data);
      createdKeyIds.push(result.id);

      expect(result.permissions.serverIds).toEqual(['server-1', 'server-2']);
    });

    it('should generate unique keys each time', async () => {
      const keys = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const result = await apiKeyService.create({
          name: uniqueId(`unique-${i}`),
          permissions: { serverIds: null },
        });
        createdKeyIds.push(result.id);
        keys.add(result.key);
      }

      expect(keys.size).toBe(10);
    });

    it('should store key hash separately from key', async () => {
      const result = await apiKeyService.create({
        name: uniqueId('hash-test'),
        permissions: { serverIds: null },
      });
      createdKeyIds.push(result.id);

      // Verify the hash is stored in database
      const dbRecord = await prisma.apiKey.findUnique({
        where: { id: result.id },
      });

      expect(dbRecord?.keyHash).toBeDefined();
      expect(dbRecord?.keyHash).not.toBe(result.key);
      expect(dbRecord?.keyHash).toMatch(/^\$2b\$/); // bcrypt hash
    });

    it('should store key prefix for lookup optimization', async () => {
      const result = await apiKeyService.create({
        name: uniqueId('prefix-test'),
        permissions: { serverIds: null },
      });
      createdKeyIds.push(result.id);

      const dbRecord = await prisma.apiKey.findUnique({
        where: { id: result.id },
      });

      expect(dbRecord?.keyPrefix).toBeDefined();
      expect(dbRecord?.keyPrefix).toBe(result.key.slice(0, 12));
    });
  });

  describe('findById', () => {
    it('should return API key by ID', async () => {
      const created = await apiKeyService.create({
        name: uniqueId('find-by-id'),
        permissions: { serverIds: null },
      });
      createdKeyIds.push(created.id);

      const result = await apiKeyService.findById(created.id);

      expect(result.id).toBe(created.id);
      expect(result.name).toBe(created.name);
    });

    it('should not return full key value', async () => {
      const created = await apiKeyService.create({
        name: uniqueId('no-full-key'),
        permissions: { serverIds: null },
      });
      createdKeyIds.push(created.id);

      const result = await apiKeyService.findById(created.id);

      // The result should not include the full key for security (only keyPrefix)
      expect((result as any).key).toBeUndefined();
    });

    it('should throw NotFoundError for non-existent key', async () => {
      await expect(apiKeyService.findById('non-existent-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return paginated API keys', async () => {
      // Create multiple keys
      for (let i = 0; i < 5; i++) {
        const key = await apiKeyService.create({
          name: uniqueId(`list-${i}`),
          permissions: { serverIds: null },
        });
        createdKeyIds.push(key.id);
      }

      const result = await apiKeyService.list({
        page: 1,
        pageSize: 3,
      });

      expect(result.items.length).toBe(3);
      expect(result.total).toBeGreaterThanOrEqual(5);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(3);
    });

    it.skip('should search by name', async () => {
      // Note: SQLite doesn't support mode: 'insensitive' in contains queries
      // This test is skipped when using SQLite
      const uniqueName = uniqueId('searchable');
      await apiKeyService.create({
        name: uniqueName,
        permissions: { serverIds: null },
      });
      const searchResult = await apiKeyService.list({ search: uniqueName });
      const foundItem = searchResult.items[0];
      expect(foundItem).toBeDefined();
      if (foundItem) {
        createdKeyIds.push(foundItem.id);
      }

      const result = await apiKeyService.list({
        search: uniqueName,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0]?.name).toBe(uniqueName);
    });

    it.skip('should search by key prefix', async () => {
      // Note: SQLite doesn't support mode: 'insensitive' in contains queries
      const created = await apiKeyService.create({
        name: uniqueId('prefix-search'),
        permissions: { serverIds: null },
      });
      createdKeyIds.push(created.id);

      // Get the prefix from the created key
      const prefix = created.key.slice(0, 12);

      const result = await apiKeyService.list({
        search: prefix,
      });

      const found = result.items.find((k) => k.id === created.id);
      expect(found).toBeDefined();
    });

    it('should not include full key values in list', async () => {
      await apiKeyService.create({
        name: uniqueId('list-no-key'),
        permissions: { serverIds: null },
      });

      const result = await apiKeyService.list();

      result.items.forEach((item) => {
        expect((item as any).key).toBeUndefined();
      });
    });
  });

  describe('delete', () => {
    it('should delete an API key', async () => {
      const created = await apiKeyService.create({
        name: uniqueId('delete'),
        permissions: { serverIds: null },
      });

      await apiKeyService.delete(created.id);

      await expect(apiKeyService.findById(created.id))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for non-existent key', async () => {
      await expect(apiKeyService.delete('non-existent-id'))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('checkNameAvailable', () => {
    it('should return true for available name', async () => {
      const result = await apiKeyService.checkNameAvailable(uniqueId('available'));
      expect(result).toBe(true);
    });

    it('should return false for taken name', async () => {
      const name = uniqueId('taken');
      const created = await apiKeyService.create({
        name,
        permissions: { serverIds: null },
      });
      createdKeyIds.push(created.id);

      const result = await apiKeyService.checkNameAvailable(name);
      expect(result).toBe(false);
    });
  });

  describe('Permission handling', () => {
    it('should store null serverIds as full access', async () => {
      const result = await apiKeyService.create({
        name: uniqueId('full-access'),
        permissions: { serverIds: null },
      });
      createdKeyIds.push(result.id);

      expect(result.permissions.serverIds).toBeNull();
    });

    it('should store array serverIds as restricted access', async () => {
      const serverIds = ['srv-1', 'srv-2'];
      const result = await apiKeyService.create({
        name: uniqueId('restricted'),
        permissions: { serverIds },
      });
      createdKeyIds.push(result.id);

      expect(result.permissions.serverIds).toEqual(serverIds);
    });

    it('should store empty array for no server access', async () => {
      const result = await apiKeyService.create({
        name: uniqueId('no-access'),
        permissions: { serverIds: [] },
      });
      createdKeyIds.push(result.id);

      expect(result.permissions.serverIds).toEqual([]);
    });
  });
});
