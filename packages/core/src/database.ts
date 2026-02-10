/**
 * Database singleton - ensures only one PrismaClient instance is used
 * This prevents connection pool exhaustion in development
 */

import { PrismaClient } from '@prisma/client';

let prismaInstance: PrismaClient | null = null;

/**
 * Get the singleton PrismaClient instance
 */
export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }
  return prismaInstance;
}

/**
 * Disconnect the PrismaClient and reset the singleton
 * Call this on graceful shutdown
 */
export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}
