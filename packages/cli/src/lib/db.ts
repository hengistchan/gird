/**
 * Shared database connection module for CLI
 * Provides singleton PrismaClient instance with proper connection management
 */

import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;

/**
 * Get or create the singleton PrismaClient instance
 * @returns PrismaClient instance
 */
export function getDb(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return prisma;
}

/**
 * Close the database connection
 * Should be called on process shutdown
 */
export async function closeDb(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Check if database connection is currently active
 * @returns true if PrismaClient instance exists
 */
export function isDbConnected(): boolean {
  return prisma !== null;
}
