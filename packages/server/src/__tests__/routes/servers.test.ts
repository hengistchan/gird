/**
 * Tests for Server Routes
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { generateApiKey, hashApiKey } from '@gird-mcp/core';
import { serverRoutes } from '../../routes/servers.js';

// Test utilities
let testCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++testCounter}`;
}

describe('Server Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let prisma: PrismaClient;
  let testApiKey: string;
  let testApiKeyId: string;
  let createdServerIds: string[] = [];

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
        name: uniqueId('test-server-key'),
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
    await app.register(serverRoutes);

    await app.ready();
    createdServerIds = [];
  });

  afterEach(async () => {
    await app.close();
    // Cleanup created servers
    for (const id of createdServerIds) {
      await prisma.server.delete({ where: { id } }).catch(() => {});
    }
  });

  describe('GET /servers', () => {
    it('should return empty array when no servers exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/servers',
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

    it('should return servers list with pagination', async () => {
      // Create a test server
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-list'),
          name: uniqueId('test-server-list'),
          type: 'STDIO',
          config: { command: 'node', args: ['--version'] },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      const response = await app.inject({
        method: 'GET',
        url: '/servers',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.meta).toHaveProperty('page');
      expect(body.meta).toHaveProperty('pageSize');
      expect(body.meta).toHaveProperty('total');
      expect(body.success).toBe(true);
    });

    it('should filter by server type', async () => {
      // Create servers of different types
      const stdioServer = await prisma.server.create({
        data: {
          id: uniqueId('srv-stdio'),
          name: uniqueId('test-stdio'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(stdioServer.id);

      const sseServer = await prisma.server.create({
        data: {
          id: uniqueId('srv-sse'),
          name: uniqueId('test-sse'),
          type: 'SSE',
          config: { url: 'http://example.com/sse' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(sseServer.id);

      const response = await app.inject({
        method: 'GET',
        url: '/servers?type=STDIO',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      body.data.forEach((s: any) => {
        expect(s.type).toBe('STDIO');
      });
    });

    it('should return 401 without authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/servers',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should support pagination parameters', async () => {
      // Create multiple servers
      for (let i = 0; i < 5; i++) {
        const srv = await prisma.server.create({
          data: {
            id: uniqueId(`srv-page-${i}`),
            name: uniqueId(`test-page-${i}`),
            type: 'STDIO',
            config: { command: 'node' },
            status: 'ACTIVE',
          },
        });
        createdServerIds.push(srv.id);
      }

      const response = await app.inject({
        method: 'GET',
        url: '/servers?page=1&pageSize=2',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.length).toBe(2);
      expect(body.meta.page).toBe(1);
      expect(body.meta.pageSize).toBe(2);
    });
  });

  describe('GET /servers/:id', () => {
    it('should return a specific server', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-get'),
          name: uniqueId('test-server-get'),
          type: 'STDIO',
          config: { command: 'node', args: ['--version'] },
          status: 'ACTIVE',
          description: 'Test description',
        },
      });
      createdServerIds.push(server.id);

      const response = await app.inject({
        method: 'GET',
        url: `/servers/${server.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.server.id).toBe(server.id);
      expect(body.data.server.name).toBe(server.name);
      expect(body.data.server.type).toBe('STDIO');
      expect(body.data.server.description).toBe('Test description');
    });

    it('should return 404 for non-existent server', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/servers/non-existent-id',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should include deployments in response', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-deploy'),
          name: uniqueId('test-server-deploy'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      const deployment = await prisma.deployment.create({
        data: {
          id: uniqueId('deploy'),
          serverId: server.id,
          type: 'LOCAL_PROCESS',
          status: 'RUNNING',
          port: 3000,
          host: '127.0.0.1',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/servers/${server.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data.server.deployments).toBeDefined();
      expect(body.data.server.deployments.length).toBe(1);
      expect(body.data.server.deployments[0].id).toBe(deployment.id);

      // Cleanup
      await prisma.deployment.delete({ where: { id: deployment.id } });
    });
  });

  describe('POST /servers', () => {
    it('should create a new STDIO server', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/servers',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('new-stdio-server'),
          type: 'STDIO',
          config: {
            command: 'node',
            args: ['--version'],
          },
          description: 'New STDIO server',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBeDefined();
      expect(body.data.type).toBe('STDIO');
      expect(body.data.id).toBeDefined();
      expect(body.message).toContain('created');

      createdServerIds.push(body.data.id);
    });

    it('should create a new SSE server', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/servers',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('new-sse-server'),
          type: 'SSE',
          config: {
            url: 'https://example.com/mcp',
            headers: { 'X-Custom': 'value' },
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.data.type).toBe('SSE');

      createdServerIds.push(body.data.id);
    });

    it('should return 400 for invalid server data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/servers',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          // Missing required 'name' field
          type: 'STDIO',
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should return 400 for duplicate server name', async () => {
      const duplicateName = uniqueId('duplicate-name');
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-dup'),
          name: duplicateName,
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      const response = await app.inject({
        method: 'POST',
        url: '/servers',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: duplicateName,
          type: 'STDIO',
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('PUT /servers/:id', () => {
    it('should update server name', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-update'),
          name: uniqueId('original-name'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/servers/${server.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: uniqueId('updated-name'),
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.data.name).not.toBe(server.name);
    });

    it('should update server config', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-config'),
          name: uniqueId('config-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      const response = await app.inject({
        method: 'PUT',
        url: `/servers/${server.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          config: {
            command: 'python',
            args: ['-m', 'server'],
          },
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should return 404 for non-existent server', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/servers/non-existent-id',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          name: 'updated-name',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /servers/:id', () => {
    it('should delete a server', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-delete'),
          name: uniqueId('to-delete'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });

      const response = await app.inject({
        method: 'DELETE',
        url: `/servers/${server.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);

      // Verify deleted
      const deletedServer = await prisma.server.findUnique({
        where: { id: server.id },
      });
      expect(deletedServer).toBeNull();
    });

    it('should return 404 for non-existent server', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/servers/non-existent-id',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should cascade delete deployments', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('srv-cascade'),
          name: uniqueId('cascade-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });

      const deployment = await prisma.deployment.create({
        data: {
          id: uniqueId('cascade-deploy'),
          serverId: server.id,
          type: 'LOCAL_PROCESS',
          status: 'RUNNING',
        },
      });

      // Delete server
      await app.inject({
        method: 'DELETE',
        url: `/servers/${server.id}`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
        },
      });

      // Verify deployment is also deleted
      const deletedDeployment = await prisma.deployment.findUnique({
        where: { id: deployment.id },
      });
      expect(deletedDeployment).toBeNull();
    });
  });
});
