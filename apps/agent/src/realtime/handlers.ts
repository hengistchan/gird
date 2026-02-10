/**
 * HTTP handlers for SSE endpoints
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { sseManager, generateClientId } from './sse.js';
import { emitDeploymentStatus, emitHealthStatus, emitLog, emitMetric, emitError } from './events.js';

/**
 * SSE endpoint handler - establishes Server-Sent Events connection
 */
export async function sseHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Get client metadata from auth if available
  const apiKey = (request as unknown as { apiKey?: { id: string; tenantId?: string } }).apiKey;

  // Get tenantId for connection limit checking
  const tenantId = apiKey?.tenantId;

  // Check connection limits BEFORE setting headers
  const limitCheck = sseManager.canConnect(tenantId);
  if (!limitCheck.success) {
    reply.code(429).send({
      error: limitCheck.reason || 'Connection limit reached',
      retryAfter: 60,
    });
    return;
  }

  // Set SSE headers
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Get query parameters for filtering
  const deploymentId = (request.query as { deploymentId?: string })?.deploymentId;
  const serverId = (request.query as { serverId?: string })?.serverId;
  const channels = (request.query as { channels?: string })?.channels?.split(',') ?? ['all'];

  // Generate client ID
  const clientId = generateClientId();

  // Get client IP address
  const ipAddress = (request.headers['x-forwarded-for'] as string | undefined) ?? request.ip ?? 'unknown';

  // Build metadata object (only include defined properties)
  const metadata: {
    deploymentId?: string;
    serverId?: string;
    tenantId?: string;
    ipAddress: string;
  } = { ipAddress };

  if (deploymentId !== undefined) metadata.deploymentId = deploymentId;
  if (serverId !== undefined) metadata.serverId = serverId;
  if (apiKey?.tenantId !== undefined) metadata.tenantId = apiKey.tenantId;

  // Register the client
  sseManager.registerClient(clientId, reply.raw as never, metadata);

  // Subscribe to channels
  sseManager.subscribe(clientId, channels);

  // Handle client disconnect
  reply.raw.on('close', () => {
    sseManager.disconnect(clientId);
  });

  // Send keepalive comments every 30 seconds
  const keepalive = setInterval(() => {
    try {
      reply.raw.write(': keepalive\n\n');
    } catch {
      clearInterval(keepalive);
    }
  }, 30000);

  reply.raw.on('close', () => {
    clearInterval(keepalive);
  });

  // Keep the connection open
  reply.raw.on('error', () => {
    sseManager.disconnect(clientId);
  });
}

/**
 * Events endpoint handler - allows emitting events via REST API
 */
export async function eventsHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as {
    type?: string;
    deploymentId?: string;
    serverId?: string;
    data?: unknown;
  };

  if (!body?.type) {
    reply.status(400).send({ error: 'Event type is required' });
    return;
  }

  const apiKey = (request as unknown as { apiKey?: { id: string; tenantId?: string } }).apiKey;

  try {
    switch (body.type) {
      case 'deployment_status':
        if (!body.deploymentId) {
          reply.status(400).send({ error: 'deploymentId is required for deployment_status events' });
          return;
        }
        await emitDeploymentStatus(
          body.deploymentId,
          (body.data as { status?: string })?.status ?? 'unknown',
          apiKey?.tenantId
        );
        break;

      case 'health_status':
        if (!body.deploymentId) {
          reply.status(400).send({ error: 'deploymentId is required for health_status events' });
          return;
        }
        const healthData = body.data as { status?: string; responseTime?: number; message?: string };
        await emitHealthStatus(
          body.deploymentId,
          healthData?.status as 'healthy' | 'unhealthy' | 'degraded' ?? 'unhealthy',
          healthData?.responseTime,
          healthData?.message
        );
        break;

      case 'log':
        if (!body.serverId) {
          reply.status(400).send({ error: 'serverId is required for log events' });
          return;
        }
        const logData = body.data as { level?: string; message?: string; context?: Record<string, unknown> };
        emitLog(
          body.deploymentId ?? '',
          body.serverId,
          logData?.level ?? 'info',
          logData?.message ?? '',
          logData?.context,
          apiKey?.tenantId
        );
        break;

      case 'metric':
        const metricData = body.data as { name?: string; value?: number; labels?: Record<string, string | number | boolean> };
        if (!metricData?.name) {
          reply.status(400).send({ error: 'name is required for metric events' });
          return;
        }
        emitMetric(
          metricData.name,
          metricData.value ?? 0,
          metricData.labels ?? {},
          apiKey?.tenantId
        );
        break;

      case 'error':
        const errorData = body.data as { error?: string; context?: Record<string, unknown> };
        emitError(
          errorData?.error ?? 'Unknown error',
          body.deploymentId,
          body.serverId,
          errorData?.context,
          apiKey?.tenantId
        );
        break;

      default:
        reply.status(400).send({ error: `Unknown event type: ${body.type}` });
        return;
    }

    reply.send({ success: true, message: 'Event emitted' });
  } catch (error) {
    reply.status(500).send({
      error: 'Failed to emit event',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * SSE stats endpoint handler - returns connection statistics
 */
export async function sseStatsHandler(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const stats = sseManager.getConnectionStats();
  reply.send(stats);
}
