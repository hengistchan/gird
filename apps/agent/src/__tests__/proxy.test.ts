/**
 * Tests for MCP proxy module
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { generateApiKey, hashApiKey } from '@gird-mcp/core';
import { proxyHandler, healthHandler, listServersHandler, validateMcpRequest, createMcpError } from '../proxy.js';
import { authHook } from '../auth.js';
import { stdioProcessPool } from '../stdio/index.js';

// Mock MCP server path
const MOCK_SERVER_PATH = path.resolve(
  __dirname,
  './fixtures/mock-mcp-server.cjs'
);

// Test utilities
let testCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++testCounter}`;
}

describe('Proxy Module', () => {
  let prisma: PrismaClient;
  let testApiKey: string;
  let testApiKeyId: string;

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
        name: uniqueId('proxy-test-key'),
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

  describe('validateMcpRequest', () => {
    it('should validate correct MCP request', () => {
      const request = {
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'tools/list',
      };

      const result = validateMcpRequest(request);

      expect(result.jsonrpc).toBe('2.0');
      expect(result.id).toBe('test-1');
      expect(result.method).toBe('tools/list');
    });

    it('should throw for invalid jsonrpc version', () => {
      const request = {
        jsonrpc: '1.0',
        id: 'test-1',
        method: 'test',
      };

      expect(() => validateMcpRequest(request)).toThrow('jsonrpc version must be "2.0"');
    });

    it('should throw for missing id', () => {
      const request = {
        jsonrpc: '2.0',
        method: 'test',
      };

      expect(() => validateMcpRequest(request)).toThrow('id must be a string or number');
    });

    it('should throw for missing method', () => {
      const request = {
        jsonrpc: '2.0',
        id: 'test-1',
      };

      expect(() => validateMcpRequest(request)).toThrow('method must be a string');
    });

    it('should throw for non-object body', () => {
      expect(() => validateMcpRequest(null)).toThrow('request body must be a JSON-RPC object');
      expect(() => validateMcpRequest('string')).toThrow('request body must be a JSON-RPC object');
      expect(() => validateMcpRequest(123)).toThrow('request body must be a JSON-RPC object');
    });

    it('should accept numeric id', () => {
      const request = {
        jsonrpc: '2.0',
        id: 123,
        method: 'test',
      };

      const result = validateMcpRequest(request);
      expect(result.id).toBe(123);
    });

    it('should preserve params', () => {
      const request = {
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'tools/call',
        params: { name: 'echo', arguments: { message: 'hello' } },
      };

      const result = validateMcpRequest(request);
      expect(result.params).toEqual({ name: 'echo', arguments: { message: 'hello' } });
    });
  });

  describe('createMcpError', () => {
    it('should create MCP error response', () => {
      const response = createMcpError('test-1', -32603, 'Internal error');

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe('test-1');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32603);
      expect(response.error!.message).toBe('Internal error');
    });

    it('should include data in error response', () => {
      const response = createMcpError('test-1', -32602, 'Invalid params', {
        field: 'arguments',
        reason: 'missing',
      });

      expect(response.error!.data).toEqual({
        field: 'arguments',
        reason: 'missing',
      });
    });

    it('should accept numeric id', () => {
      const response = createMcpError(123, -32601, 'Method not found');

      expect(response.id).toBe(123);
    });
  });

  describe('healthHandler', () => {
    it('should return health status', async () => {
      const mockRequest = {};
      const mockReply = {
        send: vi.fn(),
      };

      await healthHandler(mockRequest as any, mockReply as any);

      expect(mockReply.send).toHaveBeenCalledWith({
        status: 'ok',
        timestamp: expect.any(String),
      });
    });

    it('should return valid ISO timestamp', async () => {
      const mockRequest = {};
      const mockReply = {
        send: vi.fn(),
      };

      await healthHandler(mockRequest as any, mockReply as any);

      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call).toBeDefined();
      const timestamp = new Date(call.timestamp);
      expect(timestamp.toISOString()).toBe(call.timestamp);
    });
  });

  describe('listServersHandler', () => {
    it('should list all servers', async () => {
      // Create test server
      const server = await prisma.server.create({
        data: {
          id: uniqueId('list-srv'),
          name: uniqueId('list-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });

      const mockRequest = { prisma };
      const mockReply = {
        send: vi.fn(),
      };

      await listServersHandler(mockRequest as any, mockReply as any);

      expect(mockReply.send).toHaveBeenCalled();
      const call = mockReply.send.mock.calls[0]?.[0];
      expect(call).toBeDefined();
      expect(call.servers).toBeInstanceOf(Array);

      const found = call.servers.find((s: any) => s.id === server.id);
      expect(found).toBeDefined();

      await prisma.server.delete({ where: { id: server.id } });
    });
  });

  describe('proxyHandler', () => {
    let app: ReturnType<typeof Fastify>;

    beforeEach(async () => {
      app = Fastify({ logger: false });

      app.addHook('onRequest', async (request: any) => {
        request.prisma = prisma;
      });

      app.all('/mcp/:serverId/*', {
        onRequest: authHook,
        handler: proxyHandler,
      });

      app.get('/health', healthHandler);

      await app.ready();
    });

    afterEach(async () => {
      await app.close();
      await stdioProcessPool.terminateAll();
    });

    it('should proxy to STDIO server', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('stdio-proxy'),
          name: uniqueId('stdio-proxy-server'),
          type: 'STDIO',
          config: {
            command: 'node',
            args: [MOCK_SERVER_PATH],
          },
          status: 'ACTIVE',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/mcp/${server.id}/`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 'stdio-test-1',
          method: 'tools/list',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.result).toBeDefined();
      expect(body.result.tools).toBeInstanceOf(Array);

      await stdioProcessPool.terminate(server.id);
      await prisma.server.delete({ where: { id: server.id } });
    });

    it('should return MCP error for non-existent server', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/mcp/non-existent-server-id/',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 'error-test-1',
          method: 'tools/list',
        },
      });

      // Should return MCP-formatted error
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.error).toBeDefined();
      expect(body.error.message).toContain('not found');
    });

    it('should return 401 for missing auth', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('no-auth'),
          name: uniqueId('no-auth-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/mcp/${server.id}/`,
        headers: {
          'Content-Type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 'no-auth-test',
          method: 'tools/list',
        },
      });

      expect(response.statusCode).toBe(401);

      await prisma.server.delete({ where: { id: server.id } });
    });

    it('should return MCP error for invalid JSON-RPC', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('invalid-jsonrpc'),
          name: uniqueId('invalid-jsonrpc-server'),
          type: 'STDIO',
          config: { command: 'node' },
          status: 'ACTIVE',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: `/mcp/${server.id}/`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          jsonrpc: '1.0', // Invalid version
          id: 'invalid-test',
          method: 'test',
        },
      });

      expect(response.statusCode).toBe(502);

      await prisma.server.delete({ where: { id: server.id } });
    });

    it('should handle SSE server config', async () => {
      const server = await prisma.server.create({
        data: {
          id: uniqueId('sse-proxy'),
          name: uniqueId('sse-proxy-server'),
          type: 'SSE',
          config: {
            url: 'https://httpbin.org/status/200', // Using httpbin for testing
          },
          status: 'ACTIVE',
        },
      });

      // Note: This will actually make an HTTP request to httpbin
      // In a real test environment, you'd mock fetch or use a local server
      const response = await app.inject({
        method: 'POST',
        url: `/mcp/${server.id}/`,
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 'sse-test-1',
          method: 'test',
        },
      });

      // The response depends on whether the SSE server is reachable
      // httpbin may return various status codes (200, 400, 502, etc.)
      // For this test, we just verify the routing works
      expect([200, 400, 502]).toContain(response.statusCode);

      await prisma.server.delete({ where: { id: server.id } });
    });
  });

  describe('Error Formatting', () => {
    it('should format ProxyError as MCP error', async () => {
      const app = Fastify({ logger: false });
      app.addHook('onRequest', async (request: any) => {
        request.prisma = prisma;
      });
      app.all('/mcp/:serverId/*', { onRequest: authHook, handler: proxyHandler });
      await app.ready();

      // Non-existent server should return MCP error format
      const response = await app.inject({
        method: 'POST',
        url: '/mcp/non-existent/',
        headers: {
          Authorization: `Bearer ${testApiKey}`,
          'Content-Type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        },
      });

      const body = response.json();
      expect(body.jsonrpc).toBe('2.0');
      expect(body.id).toBe(1);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(-32603);

      await app.close();
    });
  });
});
