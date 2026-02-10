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
    schema: {
      description: 'List all API keys',
      tags: ['API Keys'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'number', minimum: 1, default: 1, description: 'Page number' },
          pageSize: { type: 'number', minimum: 1, maximum: 100, default: 20, description: 'Items per page' },
          search: { type: 'string', description: 'Search in key name' },
        },
      },
      response: {
        200: { description: 'List of API keys' },
        401: { $ref: '#/components/schemas/Error' },
      },
    },
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
    schema: {
      description: 'Get a specific API key by ID',
      tags: ['API Keys'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'API Key ID' },
        },
      },
      response: {
        200: { description: 'API Key details' },
        401: { $ref: '#/components/schemas/Error' },
        404: { $ref: '#/components/schemas/Error' },
      },
    },
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
    schema: {
      description: 'Create a new API key',
      tags: ['API Keys'],
      security: [{ bearerAuth: [] }],
      body: { $ref: '#/components/schemas/CreateApiKeyRequest' },
      response: {
        201: { description: 'API Key created successfully' },
        400: { $ref: '#/components/schemas/Error' },
        401: { $ref: '#/components/schemas/Error' },
      },
    },
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
    schema: {
      description: 'Delete an API key',
      tags: ['API Keys'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string', description: 'API Key ID' },
        },
      },
      response: {
        200: { description: 'API Key deleted successfully' },
        401: { $ref: '#/components/schemas/Error' },
        404: { $ref: '#/components/schemas/Error' },
      },
    },
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    await apiKeyService.delete(id);

    return deletedResponse('API Key');
  });
}
