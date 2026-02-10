/**
 * API Server - REST API for managing MCP servers and API keys
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { PrismaClient } from '@prisma/client';
import { serverRoutes } from './routes/servers.js';
import { keyRoutes } from './routes/keys.js';
import { getConfig, createLogger, GirdError } from '@gird/core';

// Re-export generateApiKey and hashApiKey for use in routes
export { generateApiKey, hashApiKey } from '@gird/core';

// Extend Fastify instance type to include prisma
declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    prisma: PrismaClient;
  }
}

const config = getConfig();
const logger = createLogger('api');

async function createServer() {
  const prisma = new PrismaClient();

  const fastify = Fastify({
    logger: false, // We use our own logger
    trustProxy: true,
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Add Prisma to request and instance context
  fastify.addHook('onRequest', async (request) => {
    request.prisma = prisma;
  });

  // Also add to instance for use in route handlers
  fastify.prisma = prisma;

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    logger.error('Request error', error instanceof Error ? error : undefined, {
      method: request.method,
      url: request.url,
    });

    if (error instanceof GirdError) {
      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    // Handle Zod validation errors
    const zodError = error as { validation?: unknown };
    if (zodError.validation) {
      reply.code(400).send({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: zodError.validation,
      });
      return;
    }

    // Generic error
    reply.code(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  });

  // Not found handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Not found',
      code: 'NOT_FOUND',
      path: request.url,
    });
  });

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Register routes
  await fastify.register(serverRoutes, { prefix: '/api' });
  await fastify.register(keyRoutes, { prefix: '/api' });

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    await prisma.$disconnect();
  });

  return fastify;
}

async function main() {
  const server = await createServer();

  const host = config.api.host;
  const port = config.api.port;

  try {
    await server.listen({ port, host });
    logger.info(`API server listening on ${host}:${port}`);
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
