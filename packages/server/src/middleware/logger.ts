/**
 * Request logging middleware for the API server
 * Tracks all API requests for debugging and monitoring
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '@gird/core';

export interface RequestLogContext {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  duration?: number;
  ip?: string;
  userAgent?: string;
  authContext?: {
    apiKeyId?: string;
    tenantId?: string;
  };
}

/**
 * Request logging hook that logs all incoming requests
 * Logs request details on response completion with timing information
 */
export async function requestLoggerHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const startTime = Date.now();

  // Ensure request ID is set (Fastify auto-generates one, but we ensure it's a string)
  if (!request.id) {
    request.id = crypto.randomUUID();
  }

  // Extract request info
  const userAgent = request.headers['user-agent'];
  const context: RequestLogContext = {
    requestId: String(request.id),
    method: request.method,
    url: request.url,
    ip: request.ip,
    ...(userAgent && { userAgent }),
  };

  // Add auth context if available (set by auth middleware)
  const auth = (request as { auth?: { apiKeyId?: string; tenantId?: string } }).auth;
  if (auth) {
    const authContext: RequestLogContext['authContext'] = {};
    if (auth.apiKeyId) {
      authContext.apiKeyId = auth.apiKeyId;
    }
    if (auth.tenantId) {
      authContext.tenantId = auth.tenantId;
    }
    if (Object.keys(authContext).length > 0) {
      context.authContext = authContext;
    }
  }

  // Log on response completion using onResponse hook (available on reply)
  reply.raw.on('finish', () => {
    const duration = Date.now() - startTime;
    context.status = reply.statusCode;
    context.duration = duration;

    // Log level based on status code
    if (reply.statusCode >= 500) {
      logger.error('API Request', undefined, {
        method: context.method,
        url: context.url,
        status: context.status,
        duration: context.duration,
        requestId: context.requestId,
        ...(context.ip && { ip: context.ip }),
        ...(context.authContext && { auth: context.authContext }),
      });
    } else if (reply.statusCode >= 400) {
      logger.warn('API Request', {
        method: context.method,
        url: context.url,
        status: context.status,
        duration: context.duration,
        requestId: context.requestId,
        ...(context.ip && { ip: context.ip }),
        ...(context.authContext && { auth: context.authContext }),
      });
    } else {
      logger.info('API Request', {
        method: context.method,
        url: context.url,
        status: context.status,
        duration: context.duration,
        requestId: context.requestId,
        ...(context.ip && { ip: context.ip }),
        ...(context.authContext && { auth: context.authContext }),
      });
    }
  });
}

/**
 * Log an error with request context
 */
export function logError(error: unknown, context: RequestLogContext): void {
  const errorObj = error instanceof Error ? error : new Error(String(error));

  const logData: Record<string, unknown> = {
    method: context.method,
    url: context.url,
    requestId: context.requestId,
    ...(context.ip && { ip: context.ip }),
  };

  logger.error('API Error', errorObj, logData);
}

/**
 * Add X-Request-ID header to all responses for tracing
 */
export async function requestIdHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  reply.header('X-Request-ID', String(request.id));
}
