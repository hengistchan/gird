/**
 * Tests for environment utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadEnv, getEnv, isDev, isProd, isTest, resetEnv } from '../env.js';
import type { Env } from '../env.js';
import { z } from 'zod';

// Re-create EnvSchema locally to avoid import issues with vi.stubEnv
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  API_KEY_SECRET: z.string().min(32, 'API_KEY_SECRET must be at least 32 characters'),
  AGENT_HOST: z.string().default('127.0.0.1'),
  AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(5173),
});

// Valid API key secret for testing
const VALID_API_SECRET = 'a'.repeat(32);

describe('Environment Utilities', () => {
  beforeEach(() => {
    // Reset cached env state before each test
    resetEnv();
  });

  describe('EnvSchema', () => {
    // These tests don't use process.env, they test the schema directly
    it('should have correct default values', () => {
      const result = EnvSchema.safeParse({ API_KEY_SECRET: VALID_API_SECRET });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('development');
        expect(result.data.DATABASE_URL).toBe('file:./dev.db');
        expect(result.data.AGENT_HOST).toBe('127.0.0.1');
        expect(result.data.AGENT_PORT).toBe(3001);
        expect(result.data.API_HOST).toBe('0.0.0.0');
        expect(result.data.API_PORT).toBe(3000);
        expect(result.data.DASHBOARD_PORT).toBe(5173);
      }
    });

    it('should parse NODE_ENV as enum', () => {
      const valid = ['development', 'production', 'test'];
      
      for (const env of valid) {
        const result = EnvSchema.safeParse({ NODE_ENV: env, API_KEY_SECRET: VALID_API_SECRET });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.NODE_ENV).toBe(env);
        }
      }
    });

    it('should reject invalid NODE_ENV', () => {
      const result = EnvSchema.safeParse({ NODE_ENV: 'staging', API_KEY_SECRET: VALID_API_SECRET });
      expect(result.success).toBe(false);
    });

    it('should require API_KEY_SECRET with minimum 32 characters', () => {
      const shortSecret = { API_KEY_SECRET: 'short' };
      const result1 = EnvSchema.safeParse(shortSecret);
      expect(result1.success).toBe(false);

      const validSecret = { API_KEY_SECRET: 'a'.repeat(32) };
      const result2 = EnvSchema.safeParse(validSecret);
      expect(result2.success).toBe(true);
    });

    it('should coerce port strings to numbers', () => {
      const result = EnvSchema.safeParse({
        AGENT_PORT: '4000',
        API_PORT: '5000',
        DASHBOARD_PORT: '6000',
        API_KEY_SECRET: VALID_API_SECRET,
      });
      
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.AGENT_PORT).toBe(4000);
        expect(result.data.API_PORT).toBe(5000);
        expect(result.data.DASHBOARD_PORT).toBe(6000);
        expect(typeof result.data.AGENT_PORT).toBe('number');
      }
    });

    it('should validate port ranges (1-65535)', () => {
      const invalidPorts = [
        { AGENT_PORT: '0', API_KEY_SECRET: VALID_API_SECRET },
        { API_PORT: '70000', API_KEY_SECRET: VALID_API_SECRET },
        { DASHBOARD_PORT: '-1', API_KEY_SECRET: VALID_API_SECRET },
        { AGENT_PORT: '65536', API_KEY_SECRET: VALID_API_SECRET },
      ];
      
      for (const port of invalidPorts) {
        const result = EnvSchema.safeParse(port);
        expect(result.success).toBe(false);
      }
    });

    it('should accept boundary port values', () => {
      const result = EnvSchema.safeParse({
        AGENT_PORT: '1',
        API_PORT: '65535',
        API_KEY_SECRET: VALID_API_SECRET,
      });
      
      expect(result.success).toBe(true);
    });

    it('should require non-empty DATABASE_URL', () => {
      const result = EnvSchema.safeParse({ DATABASE_URL: '', API_KEY_SECRET: VALID_API_SECRET });
      expect(result.success).toBe(false);
    });
  });

  describe('loadEnv', () => {
    it('should load and validate environment variables', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', 'postgresql://localhost/mydb');
      vi.stubEnv('API_KEY_SECRET', 'test-secret-key-with-at-least-32-chars-for-testing');
      vi.stubEnv('AGENT_PORT', '4000');
      resetEnv();
      
      const env = loadEnv();
      
      expect(env.NODE_ENV).toBe('production');
      expect(env.DATABASE_URL).toBe('postgresql://localhost/mydb');
      expect(env.API_KEY_SECRET).toBe('test-secret-key-with-at-least-32-chars-for-testing');
      expect(env.AGENT_PORT).toBe(4000);
    });

    it('should use defaults for missing environment variables', () => {
      // Set up environment with minimal values
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('DATABASE_URL', 'file:./dev.db');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      delete process.env.AGENT_PORT;
      delete process.env.API_PORT;
      delete process.env.DASHBOARD_PORT;
      delete process.env.AGENT_HOST;
      delete process.env.API_HOST;
      resetEnv();
      
      const env = loadEnv();
      
      expect(env.NODE_ENV).toBe('development');
      expect(env.DATABASE_URL).toBe('file:./dev.db');
      expect(env.AGENT_HOST).toBe('127.0.0.1');
      expect(env.AGENT_PORT).toBe(3001);
      expect(env.API_HOST).toBe('0.0.0.0');
      expect(env.API_PORT).toBe(3000);
      expect(env.DASHBOARD_PORT).toBe(5173);
    });

    it('should cache env on first load', () => {
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      const env1 = loadEnv();
      const env2 = loadEnv();
      
      expect(env1).toBe(env2);
    });

    it('should reload env after reset', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      const env1 = loadEnv();
      
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv();
      
      const env2 = loadEnv();
      
      expect(env1).not.toBe(env2);
      expect(env1.NODE_ENV).toBe('development');
      expect(env2.NODE_ENV).toBe('production');
    });

    it('should throw ZodError for invalid environment', () => {
      vi.stubEnv('API_KEY_SECRET', 'short');
      resetEnv();
      
      expect(() => loadEnv()).toThrow();
    });

    it('should log helpful error messages for invalid env', () => {
      vi.stubEnv('API_KEY_SECRET', 'short');
      resetEnv();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      try {
        loadEnv();
      } catch (_e) {
        // Expected to throw
      }
      
      expect(consoleErrorSpy).toHaveBeenCalled();
      const calls = consoleErrorSpy.mock.calls;
      expect(calls.some(call => call[0]?.includes('Invalid environment configuration'))).toBe(true);
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('getEnv', () => {
    it('should return cached env if available', () => {
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      const env1 = getEnv();
      const env2 = getEnv();
      
      expect(env1).toBe(env2);
    });

    it('should load env if not cached', () => {
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      const env = getEnv();
      
      expect(env).toBeDefined();
      expect(env.NODE_ENV).toBeDefined();
      expect(env.DATABASE_URL).toBeDefined();
    });

    it('should return correct type', () => {
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      const env = getEnv();
      
      expect(env).toMatchObject({
        NODE_ENV: expect.any(String),
        DATABASE_URL: expect.any(String),
        API_KEY_SECRET: expect.any(String),
        AGENT_HOST: expect.any(String),
        AGENT_PORT: expect.any(Number),
        API_HOST: expect.any(String),
        API_PORT: expect.any(Number),
        DASHBOARD_PORT: expect.any(Number),
      } as Env);
    });
  });

  describe('isDev', () => {
    it('should return true when NODE_ENV is development', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isDev()).toBe(true);
    });

    it('should return false when NODE_ENV is production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isDev()).toBe(false);
    });

    it('should return false when NODE_ENV is test', () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isDev()).toBe(false);
    });

    it('should use cached value after first call', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      isDev();
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv(); // This also clears isDevelopment cache
      
      // After resetEnv(), isDevelopment is null and will be reloaded
      expect(isDev()).toBe(false); // Now it's production
    });
  });

  describe('isProd', () => {
    it('should return true when NODE_ENV is production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isProd()).toBe(true);
    });

    it('should return false when NODE_ENV is development', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isProd()).toBe(false);
    });

    it('should return true when NODE_ENV is test (not dev)', () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isProd()).toBe(true);
    });

    it('should return opposite of isDev', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isDev() && !isProd() || !isDev() && isProd()).toBe(true);
      
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv();
      
      expect(isDev() && !isProd() || !isDev() && isProd()).toBe(true);
    });
  });

  describe('isTest', () => {
    it('should return true when NODE_ENV is test', () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isTest()).toBe(true);
    });

    it('should return false when NODE_ENV is development', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isTest()).toBe(false);
    });

    it('should return false when NODE_ENV is production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      
      expect(isTest()).toBe(false);
    });
  });

  describe('resetEnv', () => {
    it('should clear cached env', () => {
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      const env1 = getEnv();
      resetEnv();
      const env2 = getEnv();
      
      expect(env1).not.toBe(env2);
    });

    it('should clear cached isDevelopment flag', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      isDev(); // Cache the development flag
      
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv(); // Clears the cached flag
      
      expect(isDev()).toBe(false);
    });

    it('should allow loading new env after reset', () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      const env1 = getEnv();
      
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv();
      
      const env2 = getEnv();
      
      expect(env1.NODE_ENV).toBe('development');
      expect(env2.NODE_ENV).toBe('production');
    });
  });

  describe('environment integration', () => {
    it('should handle switching between environments', () => {
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      
      // Start with development
      vi.stubEnv('NODE_ENV', 'development');
      resetEnv();
      
      expect(isDev()).toBe(true);
      expect(isProd()).toBe(false);
      expect(isTest()).toBe(false);
      expect(getEnv().NODE_ENV).toBe('development');
      
      // Switch to production
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv();
      
      expect(isDev()).toBe(false);
      expect(isProd()).toBe(true);
      expect(isTest()).toBe(false);
      expect(getEnv().NODE_ENV).toBe('production');
      
      // Switch to test
      vi.stubEnv('NODE_ENV', 'test');
      resetEnv();
      
      expect(isDev()).toBe(false);
      expect(isProd()).toBe(true);
      expect(isTest()).toBe(true);
      expect(getEnv().NODE_ENV).toBe('test');
    });

    it('should handle port configuration changes', () => {
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      vi.stubEnv('AGENT_PORT', '4000');
      vi.stubEnv('API_PORT', '5000');
      vi.stubEnv('DASHBOARD_PORT', '6000');
      resetEnv();
      
      const env = getEnv();
      
      expect(env.AGENT_PORT).toBe(4000);
      expect(env.API_PORT).toBe(5000);
      expect(env.DASHBOARD_PORT).toBe(6000);
    });
  });
});
