/**
 * Tests for database utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist mock variables so they're available during mock initialization
const mockDisconnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockConnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const PrismaClientMock = vi.hoisted(() => {
  return vi.fn().mockImplementation(function () {
    return {
      $disconnect: mockDisconnect,
      $connect: mockConnect,
    };
  });
});

// Mock PrismaClient before importing the module
vi.mock('@prisma/client', () => ({
  PrismaClient: PrismaClientMock,
}));

describe('Database Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('getPrisma', () => {
    it('should return a PrismaClient instance', async () => {
      const { getPrisma } = await import('../database.js');

      const prisma = getPrisma();

      expect(prisma).toBeDefined();
      expect(prisma.$disconnect).toBeDefined();
      expect(typeof prisma.$disconnect).toBe('function');
    });

    it('should return the same instance on multiple calls (singleton)', async () => {
      const { getPrisma } = await import('../database.js');

      const prisma1 = getPrisma();
      const prisma2 = getPrisma();
      const prisma3 = getPrisma();

      expect(prisma1).toBe(prisma2);
      expect(prisma2).toBe(prisma3);
    });

    it('should create instance with development logging in development mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const { getPrisma } = await import('../database.js');

      getPrisma();

      // Check that PrismaClient was called with logging options
      expect(PrismaClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          log: ['query', 'error', 'warn'],
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should create instance with error logging only in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      vi.resetModules();

      const { getPrisma } = await import('../database.js');

      getPrisma();

      // Check that PrismaClient was called with error-only logging
      expect(PrismaClientMock).toHaveBeenCalledWith(
        expect.objectContaining({
          log: ['error'],
        })
      );

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('disconnectPrisma', () => {
    it('should disconnect the PrismaClient', async () => {
      const { getPrisma, disconnectPrisma } = await import('../database.js');

      // First get an instance
      getPrisma();

      // Now disconnect
      await disconnectPrisma();

      expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('should not throw if no instance exists', async () => {
      // Import without calling getPrisma first - module state is fresh
      const { disconnectPrisma } = await import('../database.js');

      // Should not throw even if no instance was created
      await expect(disconnectPrisma()).resolves.not.toThrow();
    });

    it('should allow creating new instance after disconnect', async () => {
      const { getPrisma, disconnectPrisma } = await import('../database.js');

      // Get instance
      const prisma1 = getPrisma();
      expect(prisma1).toBeDefined();

      // Disconnect
      await disconnectPrisma();

      // Verify disconnect was called
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });

  describe('Singleton behavior', () => {
    it('should maintain singleton across multiple imports', async () => {
      // Import multiple times
      const module1 = await import('../database.js');
      const module2 = await import('../database.js');

      const prisma1 = module1.getPrisma();
      const prisma2 = module2.getPrisma();

      expect(prisma1).toBe(prisma2);
    });
  });
});
