/**
 * Authentication middleware for the API server
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { AuthenticationError } from '@gird/core';
import { verifyApiKey, extractApiKeyPrefix } from '@gird/core';

export interface AuthContext {
  apiKeyId: string;
  tenantId?: string;
  permissions: Record<string, unknown>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/**
 * Authentication hook that validates Bearer tokens
 * Throws AuthenticationError if token is missing or invalid
 */
export async function authHook(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or invalid Authorization header');
  }

  const key = authHeader.slice(7);
  const prisma = (request as { prisma?: PrismaClient }).prisma;

  if (!prisma) {
    throw new AuthenticationError('Prisma client not available');
  }

  // Find API key by prefix first (more efficient)
  // Use extractApiKeyPrefix from core for consistency (returns 12 chars)
  const keyPrefix = extractApiKeyPrefix(key);
  const apiKeys = await prisma.apiKey.findMany({
    where: { keyPrefix },
  });

  let apiKeyRecord: typeof apiKeys[number] | null = null;
  for (const record of apiKeys) {
    if (await verifyApiKey(key, record.keyHash)) {
      apiKeyRecord = record;
      break;
    }
  }

  if (!apiKeyRecord) {
    throw new AuthenticationError('Invalid API key');
  }

  // Update lastUsedAt
  await prisma.apiKey.update({
    where: { id: apiKeyRecord.id },
    data: { lastUsedAt: new Date() },
  });

  // Check IP whitelist if configured
  const ipWhitelist = extractIpWhitelist(apiKeyRecord.ipWhitelist);
  if (ipWhitelist.length > 0) {
    const clientIp = getClientIp(request);
    if (!isIpAllowed(clientIp, ipWhitelist)) {
      throw new AuthenticationError('IP address not allowed');
    }
  }

  // Build auth context - only include tenantId if it exists
  const authContext: AuthContext = {
    apiKeyId: apiKeyRecord.id,
    permissions: extractPermissions(apiKeyRecord.permissions),
  };

  if (apiKeyRecord.tenantId) {
    authContext.tenantId = apiKeyRecord.tenantId;
  }

  request.auth = authContext;
}

/**
 * Optional authentication hook
 * Attaches auth context if valid token is provided, but doesn't require it
 */
export function optionalAuthHook() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        await authHook(request, reply);
      } catch {
        // Silently fail - authentication is optional
      }
    }
  };
}

/**
 * Helper to extract IP whitelist from Prisma JsonValue
 */
function extractIpWhitelist(ipWhitelist: unknown): string[] {
  if (Array.isArray(ipWhitelist)) {
    return ipWhitelist.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/**
 * Helper to extract permissions from Prisma JsonValue
 */
function extractPermissions(permissions: unknown): Record<string, unknown> {
  if (typeof permissions === 'object' && permissions !== null && !Array.isArray(permissions)) {
    return permissions as Record<string, unknown>;
  }
  return {};
}

/**
 * Get client IP address from request
 */
function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const parts = forwarded.split(',');
    return parts[0]?.trim() ?? 'unknown';
  }
  return request.ip ?? 'unknown';
}

/**
 * Check if IP is allowed (basic implementation - supports exact matches only)
 * TODO: Implement CIDR checking for IP ranges
 */
function isIpAllowed(clientIp: string, ipWhitelist: string[]): boolean {
  return ipWhitelist.some(allowed => {
    // Exact match
    if (allowed === clientIp) {
      return true;
    }
    // TODO: Add CIDR support here
    return false;
  });
}
