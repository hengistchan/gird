/**
 * Authentication and API Key management for the Agent server
 * Supports both API keys and JWT tokens
 */

import type { PrismaClient } from '@prisma/client';
import type { ApiKeyPermissions, JwtPayload } from '@gird/core';
import { AuthenticationError, AuthorizationError, verifyApiKey, extractApiKeyPrefix } from '@gird/core';
import { verifyToken } from '@gird/core';

const API_KEY_PREFIX = 'gird_sk_';

export interface ApiKeyWithHash {
  id: string;
  key: string;
  keyHash: string;
  name: string;
  permissions: ApiKeyPermissions;
  ipWhitelist: string[];
  tenantId?: string;
}

export interface AuthContext {
  apiKeyId?: string;
  jwtPayload?: JwtPayload;
  permissions: ApiKeyPermissions;
  tenantId?: string;
  ipAddress: string;
}

// Re-export API key functions for use by other modules
export { generateApiKey, hashApiKey, verifyApiKey } from '@gird/core';

/**
 * Extract API key from Authorization header
 */
export function extractApiKey(authorization?: string): string {
  if (!authorization) {
    throw new AuthenticationError('Missing Authorization header');
  }

  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new AuthenticationError('Invalid Authorization header format. Expected: Bearer <key>');
  }

  const key = parts[1];
  if (!key) {
    throw new AuthenticationError('Missing API key in Authorization header');
  }

  if (!key.startsWith(API_KEY_PREFIX)) {
    throw new AuthenticationError('Invalid API key format');
  }

  return key;
}

/**
 * Check if an IP address is in the whitelist
 * Supports both individual IPs and CIDR ranges
 */
function isIpWhitelisted(clientIp: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) {
    return true; // Empty whitelist means all IPs are allowed
  }

  for (const allowedIp of whitelist) {
    // Check for exact match
    if (allowedIp === clientIp) {
      return true;
    }

    // Check for CIDR range match (basic implementation for /24 and /32)
    if (allowedIp.includes('/')) {
      const [network, prefixLength] = allowedIp.split('/');
      const prefix = parseInt(prefixLength!, 10);

      if (prefix === 32) {
        if (network === clientIp) return true;
      } else if (prefix === 24) {
        const networkPrefix = network!.split('.').slice(0, 3).join('.');
        const clientPrefix = clientIp.split('.').slice(0, 3).join('.');
        if (networkPrefix === clientPrefix) return true;
      }
    }
  }

  return false;
}

/**
 * Validate API key and check permissions
 * Uses prefix-based lookup to avoid N+1 query problem
 */
export async function validateApiKey(
  prisma: PrismaClient,
  key: string,
  serverId?: string,
  ipAddress?: string
): Promise<AuthContext> {
  // Extract the prefix from the incoming key for optimized lookup
  const keyPrefix = extractApiKeyPrefix(key);

  // Query API keys by prefix first (using the index) - this is much faster than loading all keys
  const candidateKeys = await prisma.apiKey.findMany({
    where: { keyPrefix },
  });

  // Verify against the smaller result set (typically 0-1 keys)
  let apiKeyRecord: typeof candidateKeys[0] | null = null;

  for (const record of candidateKeys) {
    const isValid = await verifyApiKey(key, record.keyHash);
    if (isValid) {
      apiKeyRecord = record;
      break;
    }
  }

  if (!apiKeyRecord) {
    throw new AuthenticationError('Invalid API key');
  }

  // Check if API key has expired
  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
    throw new AuthenticationError('API key has expired');
  }

  const permissions = apiKeyRecord.permissions as ApiKeyPermissions;
  const ipWhitelist = apiKeyRecord.ipWhitelist as string[] ?? [];

  // Check IP whitelist
  if (ipAddress && ipWhitelist.length > 0) {
    if (!isIpWhitelisted(ipAddress, ipWhitelist)) {
      throw new AuthenticationError(`IP address ${ipAddress} is not whitelisted for this API key`);
    }
  }

  // Check server-specific permissions
  if (
    serverId &&
    permissions.serverIds !== null &&
    permissions.serverIds !== undefined &&
    !permissions.serverIds.includes(serverId)
  ) {
    throw new AuthorizationError(`API key does not have permission to access server '${serverId}'`);
  }

  // Update last used timestamp
  await prisma.apiKey.update({
    where: { id: apiKeyRecord.id },
    data: { lastUsedAt: new Date() },
  });

  const result: AuthContext = {
    apiKeyId: apiKeyRecord.id,
    permissions,
    ipAddress: ipAddress ?? 'unknown',
  };

  // Only add tenantId if it exists
  if (apiKeyRecord.tenantId != null) {
    result.tenantId = apiKeyRecord.tenantId;
  }

  return result;
}

/**
 * Validate JWT token and return auth context
 */
export async function validateJwtToken(
  prisma: PrismaClient,
  token: string,
  serverId?: string,
  ipAddress?: string
): Promise<AuthContext> {
  let payload: JwtPayload;

  try {
    payload = await verifyToken(token);
  } catch {
    throw new AuthenticationError('Invalid or expired JWT token');
  }

  // Get the API key record to check IP whitelist
  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { id: payload.apiKeyId },
  });

  if (!apiKeyRecord) {
    throw new AuthenticationError('API key associated with token not found');
  }

  // Check IP whitelist
  const ipWhitelist = apiKeyRecord.ipWhitelist as string[] ?? [];
  if (ipAddress && ipWhitelist.length > 0) {
    if (!isIpWhitelisted(ipAddress, ipWhitelist)) {
      throw new AuthenticationError(`IP address ${ipAddress} is not whitelisted for this token`);
    }
  }

  // Check server-specific permissions
  if (
    serverId &&
    payload.permissions.serverIds !== null &&
    payload.permissions.serverIds !== undefined &&
    !payload.permissions.serverIds.includes(serverId)
  ) {
    throw new AuthorizationError(`Token does not have permission to access server '${serverId}'`);
  }

  // Update last used timestamp
  await prisma.apiKey.update({
    where: { id: payload.apiKeyId },
    data: { lastUsedAt: new Date() },
  });

  const result: AuthContext = {
    apiKeyId: payload.apiKeyId,
    jwtPayload: payload,
    permissions: payload.permissions,
    ipAddress: ipAddress ?? 'unknown',
  };

  // Only add tenantId if it exists
  if (payload.tenantId != null) {
    result.tenantId = payload.tenantId;
  }

  return result;
}

/**
 * Validate either API key or JWT token
 */
export async function validateAuth(
  prisma: PrismaClient,
  authorization: string | undefined,
  serverId: string | undefined,
  ipAddress: string | undefined
): Promise<AuthContext> {
  if (!authorization) {
    throw new AuthenticationError('Missing Authorization header');
  }

  const parts = authorization.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new AuthenticationError('Invalid Authorization header format. Expected: Bearer <key|token>');
  }

  const credential = parts[1];
  if (!credential) {
    throw new AuthenticationError('Missing credential in Authorization header');
  }

  // Try JWT token first (longer, base64-like)
  if (credential.startsWith('gird_jwt_') || !credential.startsWith(API_KEY_PREFIX)) {
    return validateJwtToken(prisma, credential, serverId, ipAddress);
  }

  // Fall back to API key validation
  return validateApiKey(prisma, credential, serverId, ipAddress);
}

/**
 * Fastify pre-handler hook for authentication (supports both API keys and JWT)
 */
export async function authHook(request: any, reply: any): Promise<void> {
  try {
    const authorization = request.headers.authorization;
    const serverId = request.params.serverId;
    const ipAddress = request.headers['x-forwarded-for'] as string ?? request.ip ?? undefined;

    const authContext = await validateAuth(request.prisma, authorization, serverId, ipAddress);

    // Attach to request for later use
    request.apiKeyId = authContext.apiKeyId;
    request.jwtPayload = authContext.jwtPayload;
    request.apiKeyPermissions = authContext.permissions;
    request.tenantId = authContext.tenantId;
    request.apiKey = {
      id: authContext.apiKeyId!,
      tenantId: authContext.tenantId,
    };
  } catch (error) {
    if (
      error instanceof AuthenticationError ||
      error instanceof AuthorizationError
    ) {
      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }
    throw error;
  }
}

/**
 * Fastify pre-handler hook for optional authentication
 * (for health checks and public endpoints)
 */
export async function optionalAuthHook(request: any): Promise<void> {
  try {
    const authorization = request.headers.authorization;
    const ipAddress = request.headers['x-forwarded-for'] as string ?? request.ip ?? undefined;

    if (authorization) {
      const authContext = await validateAuth(request.prisma, authorization, undefined, ipAddress);
      request.apiKeyId = authContext.apiKeyId;
      request.jwtPayload = authContext.jwtPayload;
      request.apiKeyPermissions = authContext.permissions;
      request.tenantId = authContext.tenantId;
      request.apiKey = {
        id: authContext.apiKeyId!,
        tenantId: authContext.tenantId,
      };
    }
  } catch {
    // Ignore auth errors for optional auth
  }
}
