/**
 * API routes for API key management
 */

import type { FastifyInstance } from 'fastify';
import { CreateApiKeySchema, IdParamsSchema, ApiKeyQuerySchema } from '../schemas.js';
import { authHook } from '../middleware/auth.js';
import {
  success,
  paginated,
  created,
  deleted as deletedResponse,
} from '../utils/response.js';
import { ApiKeyService } from '../services/index.js';

export async function keyRoutes(fastify: FastifyInstance) {
  // Initialize services
  const apiKeyService = new ApiKeyService();

  // List all API keys - requires authentication
  fastify.get('/keys', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const query = ApiKeyQuerySchema.parse(request.query);
    const { page, pageSize, search } = query;

    const result = await apiKeyService.list({
      ...(search !== undefined && { search }),
      page,
      pageSize,
    });

    return paginated(result.items, result.page, result.pageSize, result.total);
  });

  // Get a specific API key - requires authentication
  fastify.get('/keys/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    const key = await apiKeyService.findById(id);

    return success({
      key: {
        id: key.id,
        name: key.name,
        permissions: {
          ...(key.permissions.serverIds !== undefined && {
            serverIds: key.permissions.serverIds,
          }),
        },
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
      },
    });
  });

  // Create a new API key - requires authentication
  fastify.post('/keys', {
    onRequest: authHook,
  }, async (request, reply) => {
    const data = CreateApiKeySchema.parse(request.body);

    const keyData = await apiKeyService.create({
      name: data.name,
      permissions: data.permissions as any,
    });

    reply.status(201).send(created(keyData, 'API Key'));
  });

  // Delete an API key - requires authentication
  fastify.delete('/keys/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    await apiKeyService.delete(id);

    return deletedResponse('API Key');
  });
}
