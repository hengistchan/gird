/**
 * Event emitter for broadcasting server events
 */

import type { ServerEvent } from '@gird-mcp/core';
import { getPrisma } from '@gird-mcp/core';
import { sseManager } from './sse.js';

/**
 * Emit a deployment status change event
 */
export async function emitDeploymentStatus(
  deploymentId: string,
  status: string,
  tenantId?: string
): Promise<void> {
  const prisma = getPrisma();
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: { server: true },
  });

  if (!deployment) return;

  const event: ServerEvent = {
    type: 'deployment_status',
    data: {
      deploymentId,
      serverId: deployment.serverId,
      serverName: deployment.server.name,
      status,
      timestamp: new Date(),
    },
    timestamp: new Date(),
    deploymentId,
    serverId: deployment.serverId,
  };

  // Only add tenantId if it exists
  const finalTenantId = tenantId ?? deployment.server.tenantId ?? undefined;
  if (finalTenantId !== undefined) {
    (event as ServerEvent & { tenantId: string }).tenantId = finalTenantId;
  }

  sseManager.broadcast(event);
}

/**
 * Emit a health status change event
 */
export async function emitHealthStatus(
  deploymentId: string,
  status: 'healthy' | 'unhealthy' | 'degraded',
  responseTime?: number,
  message?: string
): Promise<void> {
  const prisma = getPrisma();
  const deployment = await prisma.deployment.findUnique({
    where: { id: deploymentId },
    include: { server: true },
  });

  if (!deployment) return;

  const event: ServerEvent = {
    type: 'health_status',
    data: {
      deploymentId,
      serverId: deployment.serverId,
      serverName: deployment.server.name,
      status,
      responseTime,
      message,
      timestamp: new Date(),
    },
    timestamp: new Date(),
    deploymentId,
    serverId: deployment.serverId,
  };

  // Only add tenantId if it exists
  if (deployment.server.tenantId != null) {
    (event as ServerEvent & { tenantId: string }).tenantId = deployment.server.tenantId;
  }

  sseManager.broadcast(event);
}

/**
 * Emit a log entry event
 */
export function emitLog(
  deploymentId: string,
  serverId: string,
  level: string,
  message: string,
  context?: Record<string, unknown>,
  tenantId?: string
): void {
  const event: ServerEvent = {
    type: 'log',
    data: {
      deploymentId,
      serverId,
      level,
      message,
      context,
      timestamp: new Date(),
    },
    timestamp: new Date(),
    deploymentId,
    serverId,
  };

  // Only add tenantId if it exists
  if (tenantId !== undefined) {
    (event as ServerEvent & { tenantId: string }).tenantId = tenantId;
  }

  sseManager.broadcast(event);
}

/**
 * Emit a metric update event
 */
export function emitMetric(
  name: string,
  value: number,
  labels: Record<string, string | number | boolean>,
  tenantId?: string
): void {
  const event: ServerEvent = {
    type: 'metric',
    data: {
      name,
      value,
      labels,
      timestamp: new Date(),
    },
    timestamp: new Date(),
  };

  // Only add tenantId if it exists
  if (tenantId !== undefined) {
    (event as ServerEvent & { tenantId: string }).tenantId = tenantId;
  }

  sseManager.broadcast(event);
}

/**
 * Emit an error event
 */
export function emitError(
  error: Error | string,
  deploymentId?: string,
  serverId?: string,
  context?: Record<string, unknown>,
  tenantId?: string
): void {
  const event: ServerEvent = {
    type: 'error',
    data: {
      deploymentId,
      serverId,
      error: typeof error === 'string' ? error : error.message,
      stack: typeof error === 'object' && error.stack ? error.stack : undefined,
      context,
      timestamp: new Date(),
    },
    timestamp: new Date(),
  };

  // Only add optional properties if they exist
  if (deploymentId !== undefined) {
    (event as ServerEvent & { deploymentId: string }).deploymentId = deploymentId;
  }
  if (serverId !== undefined) {
    (event as ServerEvent & { serverId: string }).serverId = serverId;
  }
  if (tenantId !== undefined) {
    (event as ServerEvent & { tenantId: string }).tenantId = tenantId;
  }

  sseManager.broadcast(event);
}
