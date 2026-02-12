/**
 * Tests for API Key Routes
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { generateApiKey, hashApiKey } from '@gird/core';
import { keyRoutes } from '../../routes/keys.js';

// Test utilities
let testCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++testCounter}`;
}

describe('API Key Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let prisma: PrismaClient;
  let testApiKey: string;
  let testApiKeyId: string;

  beforeAll(async () => {
    // Use the existing dev database
    const dbPath = path.resolve(__dirname, '../../../../../prisma/dev.db');
    process.env.DATABASE_URL = `file:${dbPath}`;

    prisma = new PrismaClient();

    // Create test API key
    testApiKey = generateApiKey();
    const keyHash = await hashApiKey(testApiKey);
    const keyRecord = await prisma.apiKey.create({
      data: {
        key: testApiKey,
        keyPrefix: testApiKey.slice(0, 12),
        keyHash,
        name: uniqueId('test-key-route'),
        permissions: { serverIds: null },
        ipWhitelist: [],
      },
    });
    testApiKeyId = keyRecord.id;
  });

  afterAll(async () => {
    await prisma.apiKey.delete({ where: { id: testApiKeyId } }).catch(() => {});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // Mock Prisma on request
    app.addHook('onRequest', async (request: any) => {
      request.prisma = prisma;
    });

    // Register routes
    await app.register(keyRoutes);

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /keys', () => {
    it('should return list of API keys', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body).toHaveProperty('meta');
      expect(body.success).toBe(true);
    });

    it('should not include full key values in list', async () => {
      // Create a new key
      const newKeyName = uniqueId('list-key');
      const createResponse = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: newKeyName,
          permissions: { serverIds: null },
        },
      });

      const createdKey = createResponse.json().data;

      const response = await app.inject({
        method: 'GET',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      const foundKey = body.data.find((k: any) => k.id === createdKey.id);

      // Should have data but not full key
      expect(foundKey).toBeDefined();
      expect(foundKey.key).toBeUndefined();

      // Cleanup
      await prisma.apiKey.delete({ where: { id: createdKey.id } });
    });

    it('should support pagination', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/keys?page=1&pageSize=10',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta.page).toBe(1);
      expect(body.meta.pageSize).toBe(10);
    });

    it('should return 401 without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/keys',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /keys/:id', () => {
    it('should return a specific API key', async () => {
      // Create a key
      const createResponse = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('get-key'),
          permissions: { serverIds: ['server-1', 'server-2'] },
        },
      });

      const createdKey = createResponse.json().data;

      const response = await app.inject({
        method: 'GET',
        url: `/keys/${createdKey.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.key.id).toBe(createdKey.id);
      expect(body.data.key.name).toBe(createdKey.name);
      expect(body.data.key.permissions.serverIds).toEqual(['server-1', 'server-2']);

      // Cleanup
      await prisma.apiKey.delete({ where: { id: createdKey.id } });
    });

    it('should return 404 for non-existent key', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/keys/non-existent-key-id',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /keys', () => {
    it('should create a new API key with full access', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('new-full-access-key'),
          permissions: { serverIds: null },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBeDefined();
      expect(body.data.key).toBeDefined();
      expect(body.data.key).toMatch(/^gird_sk_/);
      expect(body.message).toContain('created');

      // Cleanup
      await prisma.apiKey.delete({ where: { id: body.data.id } });
    });

    it('should create a new API key with restricted access', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('restricted-key'),
          permissions: { serverIds: ['server-1', 'server-2'] },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.permissions.serverIds).toEqual(['server-1', 'server-2']);

      // Cleanup
      await prisma.apiKey.delete({ where: { id: body.data.id } });
    });

    it('should return 400 for invalid key data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          // Missing required 'name' field
          permissions: { serverIds: null },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return unique key each time', async () => {
      const keys = new Set<string>();

      for (let i = 0; i < 5; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/keys',
          headers: {
            Authorization: `Bearer ${testApiKey}`,
            'Content-Type': 'application/json',
          },
          payload: {
            name: uniqueId(`unique-key-${i}`),
            permissions: { serverIds: null },
          },
        });

        const body = response.json();
        keys.add(body.data.key);

        // Cleanup
        await prisma.apiKey.delete({ where: { id: body.data.id } });
      }

      expect(keys.size).toBe(5);
    });
  });

  describe('DELETE /keys/:id', () => {
    it('should delete an API key', async () => {
      // Create a key to delete
      const createResponse = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('key-to-delete'),
          permissions: { serverIds: null },
        },
      });

      const createdKey = createResponse.json().data;

      const response = await app.inject({
        method: 'DELETE',
        url: `/keys/${createdKey.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);

      // Verify deleted
      const deletedKey = await prisma.apiKey.findUnique({
        where: { id: createdKey.id },
      });
      expect(deletedKey).toBeNull();
    });

    it('should return 404 for non-existent key', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/keys/non-existent-key-id',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should prevent using deleted key', async () => {
      // Create a key
      const createResponse = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('key-delete-test'),
          permissions: { serverIds: null },
        },
      });

      const createdKey = createResponse.json().data;
      const newKey = createdKey.key;

      // Delete the key
      await app.inject({
        method: 'DELETE',
        url: `/keys/${createdKey.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      // Try to use the deleted key
      const response = await app.inject({
        method: 'GET',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${newKey}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('API Key Permission Scenarios', () => {
    it('should create key that can access all servers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('all-servers-key'),
          permissions: { serverIds: null },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.permissions.serverIds).toBeNull();

      // Cleanup
      await prisma.apiKey.delete({ where: { id: body.data.id } });
    });

    it('should create key that can access specific servers', async () => {
      const serverIds = ['srv-1', 'srv-2', 'srv-3'];
      const response = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('specific-servers-key'),
          permissions: { serverIds },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.permissions.serverIds).toEqual(serverIds);

      // Cleanup
      await prisma.apiKey.delete({ where: { id: body.data.id } });
    });

    it('should create key with empty server list (no access)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/keys',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('no-servers-key'),
          permissions: { serverIds: [] },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.permissions.serverIds).toEqual([]);

      // Cleanup
      await prisma.apiKey.delete({ where: { id: body.data.id } });
    });
  });
});
