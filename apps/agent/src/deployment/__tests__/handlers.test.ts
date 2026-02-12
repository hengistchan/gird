/**
 * Tests for Deployment Handlers
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { generateApiKey, hashApiKey } from '@gird-mcp/core';
import {
  startDeploymentHandler,
  stopDeploymentHandler,
  getLogsHandler,
  getStatusHandler,
} from '../handlers.js';

// Test utilities
let testCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++testCounter}`;
}

describe('Deployment Handlers', () => {
  let prisma: PrismaClient;
  let testApiKey: string;
  let testApiKeyId: string;
  let createdServerIds: string[] = [];

  beforeAll(async () => {
    // Use process.cwd() to get monorepo root for consistent path
    const dbPath = path.resolve(process.cwd(), 'prisma/dev.db');
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
        name: uniqueId('deploy-handler-key'),
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

  beforeEach(() => {
    createdServerIds = [];
  });

  afterEach(async () => {
    for (const id of createdServerIds) {
      await prisma.server.delete({ where: { id } }).catch(() => {});
    }
  });

  describe('startDeploymentHandler', () => {
    it('should start STDIO server deployment', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('start-stdio'),
          name: uniqueId('start-stdio-server'),
          type: 'STDIO',
          config: { command: 'node', args: ['--version'] },
          status: 'STOPPED',
        },
      });
      createdServerIds.push(server.id);

      const mockRequest = {
        params: { serverId: server.id },
        body: { type: 'LOCAL_PROCESS' },
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await startDeploymentHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
      expect(call.deployment).toBeDefined();
      expect(call.deployment.serverId).toBe(server.id);
    });

    it('should handle SSE server (no local deployment)', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('start-sse'),
          name: uniqueId('start-sse-server'),
          type: 'SSE',
          config: { url: 'https://example.com/sse' },
          status: 'STOPPED',
        },
      });
      createdServerIds.push(server.id);

      const mockRequest = {
        params: { serverId: server.id },
        body: {},
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await startDeploymentHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
      expect(call.deployment.type).toBe('REMOTE');
    });

    it('should return 404 for non-existent server', async () => {
      const mockRequest = {
        params: { serverId: 'non-existent-id' },
        body: {},
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await startDeploymentHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(404);
    });

    it('should handle existing deployment with stale process', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('stale-deploy'),
          name: uniqueId('stale-server'),
          type: 'STDIO',
          config: { command: 'node', args: ['--version'] },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      // Create existing running deployment with a fake PID that doesn't exist
      await prisma.deployment.create({
        data: {
          id: uniqueId('stale-deploy-record'),
          serverId: server.id,
          type: 'LOCAL_PROCESS',
          status: 'RUNNING',
          pid: 9999999, // Non-existent PID
          port: 3000,
        },
      });

      const mockRequest = {
        params: { serverId: server.id },
        body: { type: 'LOCAL_PROCESS' },
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await startDeploymentHandler(mockRequest as any, mockReply as any);

      // Since the PID doesn't actually exist, the handler should detect
      // it's not really running and allow a new deployment (status 200)
      // The old deployment record will be marked as STOPPED
      expect(mockReply.code).toHaveBeenCalledWith(200);
    });
  });

  describe('stopDeploymentHandler', () => {
    it('should stop STDIO server deployment', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('stop-stdio'),
          name: uniqueId('stop-stdio-server'),
          type: 'STDIO',
          config: { command: 'node', args: ['--version'] },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      await prisma.deployment.create({
        data: {
          id: uniqueId('stop-deploy'),
          serverId: server.id,
          type: 'LOCAL_PROCESS',
          status: 'RUNNING',
        },
      });

      const mockRequest = {
        params: { serverId: server.id },
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await stopDeploymentHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
    });

    it('should handle SSE server stop (no local deployment)', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('stop-sse'),
          name: uniqueId('stop-sse-server'),
          type: 'SSE',
          config: { url: 'https://example.com/sse' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      const mockRequest = {
        params: { serverId: server.id },
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await stopDeploymentHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
    });

    it('should return 404 for non-existent server', async () => {
      const mockRequest = {
        params: { serverId: 'non-existent-id' },
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await stopDeploymentHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(404);
    });

    it('should return 404 when no running deployment exists', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('no-deploy'),
          name: uniqueId('no-deploy-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'STOPPED',
        },
      });
      createdServerIds.push(server.id);

      const mockRequest = {
        params: { serverId: server.id },
        headers: {},
        ip: '127.0.0.1',
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await stopDeploymentHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(404);
    });
  });

  describe('getLogsHandler', () => {
    it('should return logs for running deployment', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('logs-server'),
          name: uniqueId('logs-server-name'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      await prisma.deployment.create({
        data: {
          id: uniqueId('logs-deploy'),
          serverId: server.id,
          type: 'LOCAL_PROCESS',
          status: 'RUNNING',
        },
      });

      const mockRequest = {
        params: { serverId: server.id },
        query: { tail: '100' },
        headers: {},
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await getLogsHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
      expect(call.serverId).toBe(server.id);
    });

    it('should return 404 when no running deployment', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('no-logs'),
          name: uniqueId('no-logs-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'STOPPED',
        },
      });
      createdServerIds.push(server.id);

      const mockRequest = {
        params: { serverId: server.id },
        query: { tail: '100' },
        headers: {},
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await getLogsHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(404);
    });
  });

  describe('getStatusHandler', () => {
    it('should return status for local server', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('status-server'),
          name: uniqueId('status-server-name'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      await prisma.deployment.create({
        data: {
          id: uniqueId('status-deploy'),
          serverId: server.id,
          type: 'LOCAL_PROCESS',
          status: 'RUNNING',
          port: 3000,
          host: '127.0.0.1',
        },
      });

      const mockRequest = {
        params: { serverId: server.id },
        headers: {},
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await getStatusHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
      expect(call.serverId).toBe(server.id);
      expect(call.deployment).toBeDefined();
    });

    it('should return status for SSE server (remote)', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('remote-status'),
          name: uniqueId('remote-status-server'),
          type: 'SSE',
          config: { url: 'https://example.com/sse' },
          status: 'ACTIVE',
        },
      });
      createdServerIds.push(server.id);

      const mockRequest = {
        params: { serverId: server.id },
        headers: {},
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await getStatusHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
      expect(call.deployment.type).toBe('REMOTE');
    });

    it('should return 404 for non-existent server', async () => {
      const mockRequest = {
        params: { serverId: 'non-existent-id' },
        headers: {},
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await getStatusHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(404);
    });

    it('should handle server with no deployments', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('no-deploy-status'),
          name: uniqueId('no-deploy-status-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'STOPPED',
        },
      });
      createdServerIds.push(server.id);

      const mockRequest = {
        params: { serverId: server.id },
        headers: {},
        apiKey: { id: testApiKeyId },
        prisma,
      };
      const mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };

      await getStatusHandler(mockRequest as any, mockReply as any);

      expect(mockReply.code).toHaveBeenCalledWith(200);
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call.success).toBe(true);
      expect(call.deployment).toBeNull();
    });
  });
});
