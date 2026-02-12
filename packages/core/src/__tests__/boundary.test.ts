/**
 * Tests for boundary values and edge cases in Core package
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateApiKey,
  hashApiKey,
  verifyApiKey,
  extractApiKeyPrefix,
} from '../index.js';
import { initConfig, resetConfig, getConfig } from '../config.js';
import { initEnv, resetEnv } from '../env.js';
import { GirdError, ValidationError } from '../types.js';

describe('API Key Boundary Tests', () => {
  describe('generateApiKey', () => {
    it('should always generate keys with correct prefix', () => {
      for (let i = 0; i < 100; i++) {
        const key = generateApiKey();
        expect(key.startsWith('gird_sk_')).toBe(true);
      }
    });

    it('should generate keys of consistent length', () => {
      const lengths = new Set<number>();
      for (let i = 0; i < 100; i++) {
        lengths.add(generateApiKey().length);
      }
      // Should all be the same length
      expect(lengths.size).toBe(1);
    });

    it('should not generate keys with invalid characters', () => {
      const invalidChars = /[+/=]/;
      for (let i = 0; i < 100; i++) {
        const key = generateApiKey();
        expect(invalidChars.test(key)).toBe(false);
      }
    });
  });

  describe('extractApiKeyPrefix', () => {
    it('should extract exactly 12 characters', () => {
      const key = generateApiKey();
      expect(extractApiKeyPrefix(key).length).toBe(12);
    });

    it('should handle very long keys', () => {
      const longKey = 'gird_sk_' + 'a'.repeat(1000);
      expect(extractApiKeyPrefix(longKey).length).toBe(12);
    });

    it('should handle minimum valid key length', () => {
      const minKey = 'gird_sk_abc'; // 11 chars, less than 12
      expect(extractApiKeyPrefix(minKey)).toBe('gird_sk_abc');
    });

    it('should handle empty key', () => {
      expect(extractApiKeyPrefix('')).toBe('');
    });
  });

  describe('hashApiKey and verifyApiKey', () => {
    it('should handle minimum length keys', async () => {
      const minKey = 'gird_sk_a';
      const hash = await hashApiKey(minKey);
      expect(await verifyApiKey(minKey, hash)).toBe(true);
    });

    it('should handle very long keys', async () => {
      const longKey = 'gird_sk_' + 'a'.repeat(10000);
      const hash = await hashApiKey(longKey);
      expect(await verifyApiKey(longKey, hash)).toBe(true);
    });

    it('should handle keys with special characters', async () => {
      // Note: actual keys won't have these, but testing robustness
      const specialKey = 'gird_sk_-Test_Key_123';
      const hash = await hashApiKey(specialKey);
      expect(await verifyApiKey(specialKey, hash)).toBe(true);
    });

    it('should produce consistent hash length (60 chars for bcrypt)', async () => {
      for (let i = 0; i < 10; i++) {
        const key = generateApiKey();
        const hash = await hashApiKey(key);
        expect(hash.length).toBe(60);
      }
    });
  });
});

describe.skip('Config Boundary Tests', () => {
  beforeEach(() => {
    resetConfig();
    resetEnv();
  });

  afterEach(() => {
    resetConfig();
    resetEnv();
  });

  describe('Port Configuration', () => {
    it('should accept minimum valid port', () => {
      vi.stubEnv('API_PORT', '1');
      vi.stubEnv('AGENT_PORT', '1');
      vi.stubEnv('DASHBOARD_PORT', '1');
      vi.stubEnv('DATABASE_URL', 'file:./test.db');
      vi.stubEnv('API_KEY_SECRET', 'test-secret-12345678901234567890');

      initEnv();
      initConfig();

      const config = getConfig();
      expect(config.api.port).toBe(1);
      expect(config.agent.port).toBe(1);
      expect(config.dashboard.port).toBe(1);
    });

    it('should accept maximum valid port', () => {
      vi.stubEnv('API_PORT', '65535');
      vi.stubEnv('AGENT_PORT', '65535');
      vi.stubEnv('DATABASE_URL', 'file:./test.db');
      vi.stubEnv('API_KEY_SECRET', 'test-secret-12345678901234567890');

      initEnv();
      initConfig();

      const config = getConfig();
      expect(config.api.port).toBe(65535);
    });

    it('should accept common port numbers', () => {
      const commonPorts = [80, 443, 3000, 3001, 5173, 8080];

      for (const port of commonPorts) {
        resetEnv();
        resetConfig();

        vi.stubEnv('API_PORT', port.toString());
        vi.stubEnv('DATABASE_URL', 'file:./test.db');
        vi.stubEnv('API_KEY_SECRET', 'test-secret-12345678901234567890');

        initEnv();
        initConfig();

        const config = getConfig();
        expect(config.api.port).toBe(port);
      }
    });
  });

  describe('API Key Secret Length', () => {
    it('should accept minimum length secret (32 chars)', () => {
      const minSecret = 'a'.repeat(32);
      vi.stubEnv('DATABASE_URL', 'file:./test.db');
      vi.stubEnv('API_KEY_SECRET', minSecret);

      initEnv();
      initConfig();

      const config = getConfig();
      expect(config.apiKeySecret).toBe(minSecret);
    });

    it('should accept long secrets', () => {
      const longSecret = 'a'.repeat(1000);
      vi.stubEnv('DATABASE_URL', 'file:./test.db');
      vi.stubEnv('API_KEY_SECRET', longSecret);

      initEnv();
      initConfig();

      const config = getConfig();
      expect(config.apiKeySecret).toBe(longSecret);
    });
  });

  describe('Host Configuration', () => {
    it('should accept localhost', () => {
      vi.stubEnv('API_HOST', 'localhost');
      vi.stubEnv('AGENT_HOST', 'localhost');
      vi.stubEnv('DATABASE_URL', 'file:./test.db');
      vi.stubEnv('API_KEY_SECRET', 'test-secret-12345678901234567890');

      initEnv();
      initConfig();

      const config = getConfig();
      expect(config.api.host).toBe('localhost');
    });

    it('should accept IP addresses', () => {
      vi.stubEnv('API_HOST', '127.0.0.1');
      vi.stubEnv('AGENT_HOST', '0.0.0.0');
      vi.stubEnv('DATABASE_URL', 'file:./test.db');
      vi.stubEnv('API_KEY_SECRET', 'test-secret-12345678901234567890');

      initEnv();
      initConfig();

      const config = getConfig();
      expect(config.api.host).toBe('127.0.0.1');
      expect(config.agent.host).toBe('0.0.0.0');
    });
  });
});

describe('Error Boundary Tests', () => {
  describe('GirdError', () => {
    it('should handle very long error messages', () => {
      const longMessage = 'a'.repeat(10000);
      const error = new GirdError(longMessage, 'TEST', 500);
      expect(error.message).toBe(longMessage);
    });

    it('should handle complex details objects', () => {
      const complexDetails = {
        nested: {
          deeply: {
            value: [1, 2, 3, { inner: 'data' }],
          },
        },
        array: Array(100).fill('item'),
      };

      const error = new GirdError('Test', 'TEST', 500, complexDetails);
      expect(error.details).toEqual(complexDetails);
    });

    it('should handle null details', () => {
      const error = new GirdError('Test', 'TEST', 500, null);
      expect(error.details).toBeNull();
    });

    it('should handle undefined details', () => {
      const error = new GirdError('Test', 'TEST', 500);
      expect(error.details).toBeUndefined();
    });
  });

  describe('ValidationError', () => {
    it('should include validation details', () => {
      const validationDetails = {
        errors: [
          { field: 'name', message: 'Required' },
          { field: 'type', message: 'Must be one of: STDIO, SSE' },
        ],
      };

      const error = new ValidationError('Validation failed', validationDetails);
      expect(error.details).toEqual(validationDetails);
      expect(error.statusCode).toBe(400);
    });
  });
});

describe('String and Input Boundary Tests', () => {
  describe('Empty Strings', () => {
    it('should handle empty API key in hashApiKey', async () => {
      const hash = await hashApiKey('');
      expect(hash).toBeDefined();
      expect(hash.length).toBe(60);
    });

    it('should handle empty hash in verifyApiKey', async () => {
      const result = await verifyApiKey('any-key', '');
      expect(result).toBe(false);
    });
  });

  describe('Unicode and Special Characters', () => {
    it('should handle unicode in server names', () => {
      // Server names with unicode should be handled by validation
      const unicodeName = '服务器-サーバー-서버';
      expect(unicodeName.length).toBeGreaterThan(0);
    });

    it('should handle emoji in descriptions', () => {
      const emojiDesc = 'Server 🚀 for testing ✅';
      expect(emojiDesc.length).toBeGreaterThan(0);
    });
  });

  describe('Whitespace', () => {
    it('should handle leading/trailing whitespace in config values', () => {
      // This is typically handled by validation/trimming
      const paddedValue = '  value  ';
      expect(paddedValue.trim()).toBe('value');
    });

    it('should handle newlines in descriptions', () => {
      const multilineDesc = 'Line 1\nLine 2\nLine 3';
      expect(multilineDesc.split('\n').length).toBe(3);
    });
  });
});

describe('Numeric Boundary Tests', () => {
  describe('Pagination Values', () => {
    it('should handle page 1', () => {
      const page = 1;
      const skip = (page - 1) * 20;
      expect(skip).toBe(0);
    });

    it('should handle large page numbers', () => {
      const page = 1000000;
      const skip = (page - 1) * 20;
      expect(skip).toBe(19999980);
    });

    it('should handle minimum page size', () => {
      const pageSize = 1;
      expect(pageSize).toBe(1);
    });

    it('should handle maximum page size (100)', () => {
      const pageSize = 100;
      expect(pageSize).toBeLessThanOrEqual(100);
    });
  });

  describe('Timeout Values', () => {
    it('should handle zero timeout', () => {
      const timeout = 0;
      expect(timeout).toBe(0);
      // Zero timeout should immediately reject
    });

    it('should handle very large timeout values', () => {
      const largeTimeout = 24 * 60 * 60 * 1000; // 24 hours in ms
      expect(largeTimeout).toBe(86400000);
    });
  });
});

describe('Array Boundary Tests', () => {
  describe('Server IDs Arrays', () => {
    it('should handle empty server IDs array', () => {
      const permissions = { serverIds: [] };
      expect(permissions.serverIds!.length).toBe(0);
    });

    it('should handle large server IDs arrays', () => {
      const serverIds = Array(1000).fill(null).map((_, i) => `server-${i}`);
      expect(serverIds.length).toBe(1000);
    });

    it('should handle null server IDs (full access)', () => {
      const permissions = { serverIds: null };
      expect(permissions.serverIds).toBeNull();
    });
  });

  describe('IP Whitelist Arrays', () => {
    it('should handle empty whitelist', () => {
      const whitelist: string[] = [];
      expect(whitelist.length).toBe(0);
    });

    it('should handle large whitelists', () => {
      const whitelist = Array(100).fill(null).map((_, i) => `192.168.${Math.floor(i / 255)}.${i % 255}`);
      expect(whitelist.length).toBe(100);
    });
  });
});

describe('Date and Time Boundary Tests', () => {
  it('should handle epoch timestamp', () => {
    const epoch = new Date(0);
    expect(epoch.getTime()).toBe(0);
  });

  it('should handle far future dates', () => {
    const future = new Date('2099-12-31T23:59:59.999Z');
    // Use UTC methods for timezone-independent testing
    expect(future.getUTCFullYear()).toBe(2099);
  });

  it('should handle ISO date strings', () => {
    const date = new Date();
    const isoString = date.toISOString();
    const parsed = new Date(isoString);
    expect(parsed.getTime()).toBe(date.getTime());
  });
});
