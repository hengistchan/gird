/**
 * API routes for API key management
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { NotFoundError } from '@gird/core';
import { createLogger, generateApiKey, hashApiKey, extractApiKeyPrefix } from '@gird/core';
import { CreateApiKeySchema, IdParamsSchema } from '../schemas.js';
import { authHook } from '../middleware/auth.js';

const logger = createLogger('api:keys');

export async function keyRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma as PrismaClient;

  // List all API keys - requires authentication
  fastify.get('/keys', {
    onRequest: authHook,
  }, async (_request, _reply) => {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return {
      keys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        permissions: k.permissions,
        createdAt: k.createdAt.toISOString(),
        updatedAt: k.updatedAt.toISOString(),
      })),
    };
  });

  // Get a specific API key - requires authentication
  fastify.get('/keys/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    const key = await prisma.apiKey.findUnique({
      where: { id },
    });

    if (!key) {
      throw new NotFoundError('API Key', id);
    }

    return {
      key: {
        id: key.id,
        name: key.name,
        permissions: key.permissions,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
      },
    };
  });

  // Create a new API key - requires authentication
  fastify.post('/keys', {
    onRequest: authHook,
  }, async (request, reply) => {
    const data = CreateApiKeySchema.parse(request.body);

    // Generate the actual API key
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);
    const keyPrefix = extractApiKeyPrefix(apiKey);

    const key = await prisma.apiKey.create({
      data: {
        key: apiKey, // Store temporarily (will be removed on next read)
        keyPrefix,
        keyHash,
        name: data.name,
        permissions: data.permissions,
      },
    });

    logger.info(`Created API key: ${key.name} (${key.id})`);

    reply.status(201).send({
      key: {
        id: key.id,
        name: key.name,
        key: apiKey, // Only show on creation
        permissions: key.permissions,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
      },
    });
  });

  // Delete an API key - requires authentication
  fastify.delete('/keys/:id', {
    onRequest: authHook,
  }, async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    // Check if key exists
    const existing = await prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError('API Key', id);
    }

    await prisma.apiKey.delete({
      where: { id },
    });

    logger.info(`Deleted API key: ${existing.name} (${id})`);

    reply.status(204).send();
  });
}
