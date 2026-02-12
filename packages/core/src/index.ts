/**
 * Core utilities for the Gird MCP Server Manager
 */

import bcrypt from 'bcrypt';

const SALT_ROUNDS = 10;

export * from './types.js';
export * from './errors.js';
export * from './logger.js';
export * from './config.js';
export * from './env.js';
export * from './jwt.js';
export * from './database.js';
export * from './type-guards.js';
export * from './timeout.js';

// Re-export commonly used types for convenience
export type {
  UserStatus,
  User,
  Session,
  RolePermission,
  Role,
  UserRole,
  UsageRecord,
  WebhookEventType,
  Webhook,
  WebhookDelivery,
  WebhookPayload,
  UserJwtPayload,
  // API Response Types
  ApiResponse,
  ApiError,
  PaginationMeta,
  PaginatedResponse,
  ListResponse,
  // Pagination Query Types
  PaginationQuery,
  ServerListQuery,
  ApiKeyListQuery,
} from './types.js';

/**
 * Generate a new API key
 */
export function generateApiKey(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...Array.from(randomBytes)));
  return `gird_sk_${key}`.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * Extract the prefix from an API key for optimized database lookup
 * Returns the first 12 characters (gird_sk_ + 4 chars)
 */
export function extractApiKeyPrefix(key: string): string {
  return key.slice(0, 12);
}

/**
 * Hash an API key for storage using bcrypt
 */
export async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, SALT_ROUNDS);
}

/**
 * Verify an API key against a hash
 */
export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

// Re-export Prisma types for type-safe JSON field handling
export { Prisma } from '@prisma/client';
export type { PrismaClient } from '@prisma/client';
