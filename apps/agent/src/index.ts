/**
 * Agent Server - MCP Server Proxy with API Key authentication
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { authHook, optionalAuthHook } from './auth.js';
import { proxyHandler, healthHandler, listServersHandler } from './proxy.js';
import { getConfig, createLogger, getPrisma, disconnectPrisma } from '@gird/core';
import { registry } from './metrics/index.js';
import { sseHandler, eventsHandler } from './realtime/handlers.js';
import {
  startDeploymentHandler,
  stopDeploymentHandler,
  getLogsHandler,
  getStatusHandler,
} from './deployment/handlers.js';
import { reconcileOnStartup, cleanupResources } from './deployment/local-process.js';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    prisma: PrismaClient;
  }
}

const config = getConfig();
const logger = createLogger('agent');

async function createServer() {
  const prisma = getPrisma();

  const fastify = Fastify({
    logger: false, // We use our own logger
    trustProxy: true,
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Add Prisma to request context
  fastify.addHook('onRequest', async (request, _reply) => {
    request.prisma = prisma;
  });

  // Health check (no auth required)
  fastify.get('/health', {
    handler: healthHandler,
  });

  // Prometheus metrics endpoint (no auth required)
  fastify.get('/metrics', {
    handler: async (_request, reply) => {
      reply.type('text/plain');
      return await registry.metrics();
    },
  });

  // SSE endpoint for real-time events (auth optional)
  fastify.get('/events', {
    onRequest: [optionalAuthHook],
    handler: sseHandler,
  });

  // REST endpoint to emit events (auth required)
  fastify.post('/events', {
    onRequest: [authHook],
    handler: eventsHandler,
  });

  // List servers (auth optional - returns more info with auth)
  fastify.get('/servers', {
    onRequest: [optionalAuthHook],
    handler: listServersHandler,
  });

  // Get deployment logs (auth required)
  fastify.get('/deployments/:serverId/logs', {
    onRequest: [authHook],
    handler: getLogsHandler,
  });

  // Get deployment status (auth required)
  fastify.get('/deployments/:serverId/status', {
    onRequest: [authHook],
    handler: getStatusHandler,
  });

  // Start deployment (auth required)
  fastify.post('/deployments/:serverId/start', {
    onRequest: [authHook],
    handler: startDeploymentHandler,
  });

  // Stop deployment (auth required)
  fastify.post('/deployments/:serverId/stop', {
    onRequest: [authHook],
    handler: stopDeploymentHandler,
  });

  // Proxy routes (auth required)
  fastify.all('/mcp/:serverId/*', {
    onRequest: [authHook],
    handler: proxyHandler,
  });

  // Also support root-level MCP proxy
  fastify.all('/:serverId/*', {
    onRequest: [authHook],
    handler: proxyHandler,
  });

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    // Clean up deployment resources (log buffers, process handles)
    cleanupResources();
    // Disconnect database
    await disconnectPrisma();
  });

  return fastify;
}

async function main() {
  // Reconcile deployments on startup to fix stale state
  await reconcileOnStartup();

  const server = await createServer();

  const host = config.agent.host;
  const port = config.agent.port;

  try {
    await server.listen({ port, host });
    logger.info(`Agent server listening on ${host}:${port}`);
  } catch (err) {
    logger.error('Failed to start server', err as Error);
    process.exit(1);
  }

  // Handle shutdown
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Unhandled error', err);
  process.exit(1);
});
