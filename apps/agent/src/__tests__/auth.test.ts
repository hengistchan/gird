/**
 * Tests for Agent authentication module
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { generateApiKey, hashApiKey, initJwt, generateToken } from '@gird/core';
import {
  extractApiKey,
  validateApiKey,
  validateJwtToken,
  validateAuth,
  authHook,
  optionalAuthHook,
} from '../auth.js';

// Test utilities
let testCounter = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${++testCounter}`;
}

describe('Agent Auth Module', () => {
  let prisma: PrismaClient;
  let testApiKey: string;
  let testApiKeyId: string;
  let restrictedApiKey: string;
  let restrictedApiKeyId: string;
  let expiredApiKeyId: string;

  beforeAll(async () => {
    // Use process.cwd() to get monorepo root for consistent path
    const dbPath = path.resolve(process.cwd(), 'prisma/dev.db');
    process.env.DATABASE_URL = `file:${dbPath}`;

    prisma = new PrismaClient();

    // Initialize JWT for token tests
    initJwt({ secret: 'test-jwt-secret-for-auth-tests-12345', expiresIn: '1h' });

    // Create full-access test API key
    testApiKey = generateApiKey();
    const keyHash = await hashApiKey(testApiKey);
    const keyRecord = await prisma.apiKey.create({
      data: {
        key: testApiKey,
        keyPrefix: testApiKey.slice(0, 12),
        keyHash,
        name: uniqueId('agent-auth-key'),
        permissions: { serverIds: null },
        ipWhitelist: [],
      },
    });
    testApiKeyId = keyRecord.id;

    // Create restricted access API key
    restrictedApiKey = generateApiKey();
    const restrictedHash = await hashApiKey(restrictedApiKey);
    const restrictedRecord = await prisma.apiKey.create({
      data: {
        key: restrictedApiKey,
        keyPrefix: restrictedApiKey.slice(0, 12),
        keyHash: restrictedHash,
        name: uniqueId('restricted-agent-key'),
        permissions: { serverIds: ['allowed-server-1'] },
        ipWhitelist: [],
      },
    });
    restrictedApiKeyId = restrictedRecord.id;

    // Create expired API key
    const expiredKey = generateApiKey();
    const expiredHash = await hashApiKey(expiredKey);
    const expiredRecord = await prisma.apiKey.create({
      data: {
        key: expiredKey,
        keyPrefix: expiredKey.slice(0, 12),
        keyHash: expiredHash,
        name: uniqueId('expired-key'),
        permissions: { serverIds: null },
        ipWhitelist: [],
        expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
      },
    });
    expiredApiKeyId = expiredRecord.id;
  });

  afterAll(async () => {
    await prisma.apiKey.delete({ where: { id: testApiKeyId } }).catch(() => {});
    await prisma.apiKey.delete({ where: { id: restrictedApiKeyId } }).catch(() => {});
    await prisma.apiKey.delete({ where: { id: expiredApiKeyId } }).catch(() => {});
    await prisma.$disconnect();
  });

  describe('extractApiKey', () => {
    it('should extract valid API key from Bearer header', () => {
      const key = extractApiKey(`Bearer ${testApiKey}`);
      expect(key).toBe(testApiKey);
    });

    it('should throw for missing Authorization header', () => {
      expect(() => extractApiKey(undefined)).toThrow('Missing Authorization header');
    });

    it('should throw for invalid Authorization format', () => {
      expect(() => extractApiKey('Invalid Format')).toThrow('Invalid Authorization header format');
    });

    it('should throw for non-Bearer scheme', () => {
      expect(() => extractApiKey(`Basic ${testApiKey}`)).toThrow('Invalid Authorization header format');
    });

    it('should throw for missing token after Bearer', () => {
      expect(() => extractApiKey('Bearer ')).toThrow('Missing API key');
    });

    it('should throw for invalid API key format', () => {
      expect(() => extractApiKey('Bearer invalid-key-format')).toThrow('Invalid API key format');
    });

    it('should accept valid gird_sk_ prefixed keys', () => {
      const validKey = 'gird_sk_somevalidkey1234567890';
      expect(extractApiKey(`Bearer ${validKey}`)).toBe(validKey);
    });
  });

  describe('validateApiKey', () => {
    it('should validate correct API key', async () => {
      const result = await validateApiKey(prisma, testApiKey);

      expect(result.apiKeyId).toBe(testApiKeyId);
      expect(result.permissions).toBeDefined();
    });

    it('should reject invalid API key', async () => {
      await expect(validateApiKey(prisma, 'gird_sk_invalidkey12345678'))
        .rejects.toThrow('Invalid API key');
    });

    it('should reject expired API key', async () => {
      const expiredKey = await prisma.apiKey.findUnique({ where: { id: expiredApiKeyId } });

      await expect(validateApiKey(prisma, expiredKey!.key))
        .rejects.toThrow('expired');
    });

    it('should check server permissions', async () => {
      // Should succeed for allowed server
      await expect(validateApiKey(prisma, restrictedApiKey, 'allowed-server-1'))
        .resolves.toBeDefined();

      // Should fail for non-allowed server
      await expect(validateApiKey(prisma, restrictedApiKey, 'disallowed-server'))
        .rejects.toThrow('does not have permission');
    });

    it('should allow full-access key to access any server', async () => {
      await expect(validateApiKey(prisma, testApiKey, 'any-server-id'))
        .resolves.toBeDefined();
    });

    it('should update lastUsedAt on validation', async () => {
      await validateApiKey(prisma, testApiKey);

      const after = await prisma.apiKey.findUnique({ where: { id: testApiKeyId } });

      expect(after?.lastUsedAt).toBeDefined();
    });

    it('should include IP address in auth context', async () => {
      const result = await validateApiKey(prisma, testApiKey, undefined, '192.168.1.1');

      expect(result.ipAddress).toBe('192.168.1.1');
    });
  });

  describe('validateJwtToken', () => {
    it('should validate valid JWT token', async () => {
      const token = await generateToken({
        apiKeyId: testApiKeyId,
        permissions: { serverIds: null },
      });

      const result = await validateJwtToken(prisma, token);

      expect(result.apiKeyId).toBe(testApiKeyId);
      expect(result.jwtPayload).toBeDefined();
    });

    it('should reject invalid JWT token', async () => {
      await expect(validateJwtToken(prisma, 'invalid.jwt.token'))
        .rejects.toThrow('Invalid or expired JWT token');
    });

    it('should check server permissions from JWT payload', async () => {
      const token = await generateToken({
        apiKeyId: restrictedApiKeyId,
        permissions: { serverIds: ['allowed-server-1'] },
      });

      // Should succeed for allowed server
      await expect(validateJwtToken(prisma, token, 'allowed-server-1'))
        .resolves.toBeDefined();

      // Should fail for non-allowed server
      await expect(validateJwtToken(prisma, token, 'disallowed-server'))
        .rejects.toThrow('does not have permission');
    });
  });

  describe('validateAuth', () => {
    it('should validate API key credential', async () => {
      const result = await validateAuth(
        prisma,
        `Bearer ${testApiKey}`,
        undefined,
        undefined
      );

      expect(result.apiKeyId).toBe(testApiKeyId);
    });

    it('should validate JWT credential', async () => {
      const token = await generateToken({
        apiKeyId: testApiKeyId,
        permissions: { serverIds: null },
      });

      const result = await validateAuth(prisma, `Bearer ${token}`, undefined, undefined);

      expect(result.apiKeyId).toBe(testApiKeyId);
      expect(result.jwtPayload).toBeDefined();
    });

    it('should throw for missing Authorization header', async () => {
      await expect(validateAuth(prisma, undefined, undefined, undefined))
        .rejects.toThrow('Missing Authorization header');
    });

    it('should throw for invalid Authorization format', async () => {
      await expect(validateAuth(prisma, 'InvalidFormat', undefined, undefined))
        .rejects.toThrow('Invalid Authorization header format');
    });
  });

  describe('authHook', () => {
    let mockRequest: any;
    let mockReply: any;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        params: {},
        prisma,
      };
      mockReply = {
        code: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };
    });

    it('should attach auth context on valid credentials', async () => {
      mockRequest.headers.authorization = `Bearer ${testApiKey}`;

      await authHook(mockRequest, mockReply);

      expect(mockRequest.apiKeyId).toBe(testApiKeyId);
      expect(mockRequest.apiKeyPermissions).toBeDefined();
    });

    it('should send error response on invalid credentials', async () => {
      mockRequest.headers.authorization = 'Bearer gird_sk_invalid';

      await authHook(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(401);
      expect(mockReply.send).toHaveBeenCalled();
    });

    it('should extract serverId from params for permission check', async () => {
      mockRequest.headers.authorization = `Bearer ${restrictedApiKey}`;
      mockRequest.params.serverId = 'allowed-server-1';

      await authHook(mockRequest, mockReply);

      expect(mockRequest.apiKeyId).toBe(restrictedApiKeyId);
    });

    it('should reject access to unauthorized server', async () => {
      mockRequest.headers.authorization = `Bearer ${restrictedApiKey}`;
      mockRequest.params.serverId = 'disallowed-server';

      await authHook(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(403);
    });
  });

  describe('optionalAuthHook', () => {
    let mockRequest: any;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    let mockReply: any;

    beforeEach(() => {
      mockRequest = {
        headers: {},
        params: {},
        prisma,
      };
      mockReply = {};
    });

    it('should attach auth context when valid credentials provided', async () => {
      mockRequest.headers.authorization = `Bearer ${testApiKey}`;

      await optionalAuthHook(mockRequest);

      expect(mockRequest.apiKeyId).toBe(testApiKeyId);
    });

    it('should not throw when no credentials provided', async () => {
      await expect(optionalAuthHook(mockRequest)).resolves.toBeUndefined();

      expect(mockRequest.apiKeyId).toBeUndefined();
    });

    it('should not throw when invalid credentials provided', async () => {
      mockRequest.headers.authorization = 'Bearer gird_sk_invalid';

      await expect(optionalAuthHook(mockRequest)).resolves.toBeUndefined();
    });
  });

  describe('IP Whitelist', () => {
    it('should allow requests from whitelisted IP', async () => {
      const whitelistedKey = generateApiKey();
      const hash = await hashApiKey(whitelistedKey);
      const record = await prisma.apiKey.create({
        data: {
          key: whitelistedKey,
          keyPrefix: whitelistedKey.slice(0, 12),
          keyHash: hash,
          name: uniqueId('ip-whitelist'),
          permissions: { serverIds: null },
          ipWhitelist: ['127.0.0.1', '192.168.1.0/24'],
        },
      });

      const result = await validateApiKey(prisma, whitelistedKey, undefined, '192.168.1.100');
      expect(result.apiKeyId).toBe(record.id);

      await prisma.apiKey.delete({ where: { id: record.id } });
    });

    it('should reject requests from non-whitelisted IP', async () => {
      const whitelistedKey = generateApiKey();
      const hash = await hashApiKey(whitelistedKey);
      const record = await prisma.apiKey.create({
        data: {
          key: whitelistedKey,
          keyPrefix: whitelistedKey.slice(0, 12),
          keyHash: hash,
          name: uniqueId('ip-whitelist-reject'),
          permissions: { serverIds: null },
          ipWhitelist: ['127.0.0.1'],
        },
      });

      await expect(validateApiKey(prisma, whitelistedKey, undefined, '10.0.0.1'))
        .rejects.toThrow('not whitelisted');

      await prisma.apiKey.delete({ where: { id: record.id } });
    });

    it('should support CIDR /24 range matching', async () => {
      const cidrKey = generateApiKey();
      const hash = await hashApiKey(cidrKey);
      const record = await prisma.apiKey.create({
        data: {
          key: cidrKey,
          keyPrefix: cidrKey.slice(0, 12),
          keyHash: hash,
          name: uniqueId('cidr-test'),
          permissions: { serverIds: null },
          ipWhitelist: ['192.168.1.0/24'],
        },
      });

      // IP in range
      await expect(validateApiKey(prisma, cidrKey, undefined, '192.168.1.50'))
        .resolves.toBeDefined();

      // IP out of range
      await expect(validateApiKey(prisma, cidrKey, undefined, '192.168.2.1'))
        .rejects.toThrow('not whitelisted');

      await prisma.apiKey.delete({ where: { id: record.id } });
    });
  });
});
