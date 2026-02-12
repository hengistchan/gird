/**
 * Authentication middleware for the API server
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { AuthenticationError } from '@gird-mcp/core';
import { verifyApiKey, extractApiKeyPrefix } from '@gird-mcp/core';
import * as net from 'node:net';

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
 * Check if IP is allowed (supports exact matches and CIDR notation)
 * Supports IPv4 CIDR ranges (e.g., 192.168.1.0/24)
 */
export function isIpAllowed(clientIp: string, ipWhitelist: string[]): boolean {
  return ipWhitelist.some(allowed => {
    // Exact match
    if (allowed === clientIp) {
      return true;
    }

    // Check if it's a CIDR notation (contains '/')
    if (allowed.includes('/')) {
      return isIpInCidr(clientIp, allowed);
    }

    return false;
  });
}

/**
 * Check if an IP address is within a CIDR range
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const cidrParts = cidr.split('/');
  const network = cidrParts[0];
  const maskStr = cidrParts[1];

  // Validate CIDR format
  if (network === undefined || maskStr === undefined) {
    return false;
  }

  const mask = parseInt(maskStr, 10);

  // Validate IP and mask
  if (!net.isIP(network) || isNaN(mask) || mask < 0 || mask > 32) {
    return false;
  }

  // Only support IPv4 for now
  if (net.isIP(network) !== 4 || net.isIP(ip) !== 4) {
    return false;
  }

  // Convert IP to long and apply mask
  const ipLong = ipToLong(ip);
  const networkLong = ipToLong(network);
  const maskLong = getMaskLong(mask);

  // Check if IP is within the network range
  return (ipLong & maskLong) === (networkLong & maskLong);
}

/**
 * Get the 32-bit mask from CIDR prefix length
 */
export function getMaskLong(mask: number): number {
  if (mask === 0) {
    return 0;
  }
  return (~((1 << (32 - mask)) - 1)) >>> 0;
}

/**
 * Convert IPv4 address to unsigned 32-bit integer
 */
export function ipToLong(ip: string): number {
  const parts = ip.split('.');
  // Validate IPv4 format (must have exactly 4 parts)
  if (parts.length !== 4) {
    return 0;
  }
  const p0 = parts[0];
  const p1 = parts[1];
  const p2 = parts[2];
  const p3 = parts[3];
  // Validate all parts exist and are valid numbers
  if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
    return 0;
  }
  return (
    ((parseInt(p0, 10) << 24) |
      (parseInt(p1, 10) << 16) |
      (parseInt(p2, 10) << 8) |
      parseInt(p3, 10)) >>>
    0
  );
}
