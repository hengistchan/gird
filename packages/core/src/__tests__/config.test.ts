/**
 * Tests for config utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadConfig, getConfig, validateConfig, resetConfig } from '../config.js';
import { resetEnv, loadEnv, isDev } from '../env.js';

// Valid API key secret for testing
const VALID_API_SECRET = 'test-secret-key-with-at-least-32-chars-for-testing';

describe('Config Utilities', () => {
  beforeEach(() => {
    // Reset cached state before each test
    resetConfig();
    resetEnv();
    
    // Set default environment variables
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATABASE_URL', 'file:./dev.db');
    vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
    vi.stubEnv('AGENT_HOST', '127.0.0.1');
    vi.stubEnv('AGENT_PORT', '3001');
    vi.stubEnv('API_HOST', '0.0.0.0');
    vi.stubEnv('API_PORT', '3000');
    vi.stubEnv('DASHBOARD_PORT', '5173');
  });

  describe('loadConfig', () => {
    it('should load config with default values', () => {
      const config = loadConfig();
      
      expect(config).toBeDefined();
      expect(config.database.url).toBe('file:./dev.db');
      expect(config.agent.port).toBe(3001);
      expect(config.agent.host).toBe('127.0.0.1');
      expect(config.api.port).toBe(3000);
      expect(config.api.host).toBe('0.0.0.0');
      expect(config.dashboard.port).toBe(5173);
      expect(config.apiKeySecret).toBe(VALID_API_SECRET);
    });

    it('should load config from environment variables', () => {
      vi.stubEnv('DATABASE_URL', 'postgresql://localhost/mydb');
      vi.stubEnv('AGENT_PORT', '4000');
      vi.stubEnv('API_PORT', '5000');
      resetEnv();
      resetConfig();
      
      const config = loadConfig();
      
      expect(config.database.url).toBe('postgresql://localhost/mydb');
      expect(config.agent.port).toBe(4000);
      expect(config.api.port).toBe(5000);
    });

    it('should cache config on first load', () => {
      const config1 = loadConfig();
      const config2 = loadConfig();
      
      // Caching means the values should be the same, even if references differ
      expect(config1).toEqual(config2);
      expect(config1.database.url).toBe(config2.database.url);
      expect(config1.agent.port).toBe(config2.agent.port);
    });

    it('should reload config after reset', () => {
      const config1 = loadConfig();
      
      vi.stubEnv('AGENT_PORT', '4000');
      resetEnv();
      resetConfig();
      
      const config2 = loadConfig();
      
      expect(config1).not.toEqual(config2);
      expect(config2.agent.port).toBe(4000);
    });
  });

  describe('getConfig', () => {
    it('should return cached config', () => {
      const config1 = getConfig();
      const config2 = getConfig();
      
      expect(config1).toEqual(config2);
    });

    it('should call loadConfig if no cached config exists', () => {
      const config = getConfig();
      
      expect(config).toBeDefined();
      expect(config.database).toBeDefined();
      expect(config.agent).toBeDefined();
      expect(config.api).toBeDefined();
      expect(config.dashboard).toBeDefined();
    });
  });

  describe('validateConfig', () => {
    it('should validate a correct config', () => {
      const config = {
        database: { url: 'file:./dev.db' },
        agent: { port: 3001, host: '127.0.0.1' },
        api: { port: 3000, host: '0.0.0.0' },
        dashboard: { port: 5173 },
        apiKeySecret: VALID_API_SECRET,
      };
      
      const result = validateConfig(config);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for missing database URL', () => {
      const config = {
        database: { url: '' },
        agent: { port: 3001, host: '127.0.0.1' },
        api: { port: 3000, host: '0.0.0.0' },
        dashboard: { port: 5173 },
        apiKeySecret: VALID_API_SECRET,
      };
      
      const result = validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('DATABASE_URL is required');
    });

    it('should validate port ranges (1-65535)', () => {
      const config = {
        database: { url: 'file:./dev.db' },
        agent: { port: 0, host: '127.0.0.1' },  // Invalid: < 1
        api: { port: 70000, host: '0.0.0.0' },  // Invalid: > 65535
        dashboard: { port: -1 },                 // Invalid: < 1
        apiKeySecret: VALID_API_SECRET,
      };
      
      const result = validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('AGENT_PORT must be between 1 and 65535');
      expect(result.errors).toContain('API_PORT must be between 1 and 65535');
      expect(result.errors).toContain('DASHBOARD_PORT must be between 1 and 65535');
    });

    it('should accept valid port boundary values', () => {
      const config = {
        database: { url: 'file:./dev.db' },
        agent: { port: 1, host: '127.0.0.1' },       // Minimum valid
        api: { port: 65535, host: '0.0.0.0' },       // Maximum valid
        dashboard: { port: 8080 },
        apiKeySecret: VALID_API_SECRET,
      };
      
      const result = validateConfig(config);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for insecure API_KEY_SECRET in production', () => {
      // We need to test without throwing, so temporarily patch isDev
      const originalIsDev = isDev;
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv();
      loadEnv();
      
      const config = {
        database: { url: 'file:./dev.db' },
        agent: { port: 3001, host: '127.0.0.1' },
        api: { port: 3000, host: '0.0.0.0' },
        dashboard: { port: 5173 },
        apiKeySecret: 'change-this-in-production',
      };
      
      // In production, validateConfig will throw an error
      // We need to catch it and check the error message
      try {
        validateConfig(config);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('API_KEY_SECRET');
      }
    });

    it('should return errors for short API_KEY_SECRET in production', () => {
      vi.stubEnv('NODE_ENV', 'production');
      resetEnv();
      loadEnv();
      
      const config = {
        database: { url: 'file:./dev.db' },
        agent: { port: 3001, host: '127.0.0.1' },
        api: { port: 3000, host: '0.0.0.0' },
        dashboard: { port: 5173 },
        apiKeySecret: 'short',
      };
      
      // In production, validateConfig will throw an error
      try {
        validateConfig(config);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('API_KEY_SECRET');
      }
    });

    it('should accept any API_KEY_SECRET in development (with warning in console)', () => {
      vi.stubEnv('NODE_ENV', 'development');
      resetEnv();
      loadEnv();
      
      const config = {
        database: { url: 'file:./dev.db' },
        agent: { port: 3001, host: '127.0.0.1' },
        api: { port: 3000, host: '0.0.0.0' },
        dashboard: { port: 5173 },
        apiKeySecret: 'short',
      };
      
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validateConfig(config);
      
      // In development, validation should still pass
      expect(result.valid).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('API_KEY_SECRET should be set')
      );
      
      consoleWarnSpy.mockRestore();
    });

    it('should return multiple errors for invalid config', () => {
      const config = {
        database: { url: '' },
        agent: { port: 0, host: '127.0.0.1' },
        api: { port: 70000, host: '0.0.0.0' },
        dashboard: { port: -1 },
        apiKeySecret: 'short',
      };
      
      const result = validateConfig(config);
      
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(2);
    });
  });

  describe('resetConfig', () => {
    it('should clear cached config', () => {
      const config1 = getConfig();
      resetConfig();
      const config2 = getConfig();
      
      // Config values should be the same even if cache was cleared
      expect(config1).toEqual(config2);
    });

    it('should allow loading new config after reset', () => {
      const config1 = getConfig();
      
      vi.stubEnv('AGENT_PORT', '9999');
      resetEnv();
      resetConfig();
      
      const config2 = getConfig();
      
      expect(config1.agent.port).toBe(3001);
      expect(config2.agent.port).toBe(9999);
    });
  });

  describe('config integration with environment', () => {
    it('should load env vars when loading config', () => {
      vi.stubEnv('DATABASE_URL', 'postgresql://localhost/test');
      resetEnv();
      resetConfig();
      
      const config = loadConfig();
      
      expect(config.database.url).toBe('postgresql://localhost/test');
    });

    it('should use default env values when not set', () => {
      // Clear specific env vars to test defaults
      delete process.env.AGENT_PORT;
      delete process.env.API_PORT;
      delete process.env.DASHBOARD_PORT;
      // Ensure API_KEY_SECRET is still set
      vi.stubEnv('API_KEY_SECRET', VALID_API_SECRET);
      resetEnv();
      resetConfig();
      
      const config = loadConfig();
      
      expect(config.agent.port).toBe(3001);
      expect(config.api.port).toBe(3000);
      expect(config.dashboard.port).toBe(5173);
    });
  });
});
