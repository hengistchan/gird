/**
 * API Server - REST API for managing MCP servers and API keys
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { PrismaClient } from '@prisma/client';
import { serverRoutes } from './routes/servers.js';
import { keyRoutes } from './routes/keys.js';
import { getConfig, createLogger, GirdError } from '@gird/core';
import { requestLoggerHook, requestIdHook, logError, type RequestLogContext } from './middleware/logger.js';

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

  // Register Swagger for OpenAPI documentation
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'Gird API',
        description: `## Gird MCP Server Management API

**Gird** is an MCP (Model Context Protocol) server management system - a unified API gateway for deploying, managing, and proxying MCP servers with API key authentication and access control.

### Authentication

All API endpoints (except \`/health\` and \`/docs\`) require authentication using an API key in the \`Authorization\` header:

\`\`\`
Authorization: Bearer gird_sk_<your-key-here>
\`\`\`

### Server Types

Gird supports multiple MCP server types:
- **STDIO**: Local process with stdio communication
- **SSE**: Remote SSE server
- **AWS_LAMBDA**: AWS Lambda function
- **EXECUTABLE**: Executable binary

### Deployment Types

- **LOCAL_PROCESS**: Spawns child processes managed by the agent
- **DOCKER_COMPOSE**: Manages Docker containers

For more information, see the [GitHub repository](https://github.com/example/gird).`,
        version: '1.0.0',
        contact: {
          name: 'Gird Project',
        },
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Local development server',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'API Key',
            description: 'API key authentication. Use the format: Bearer gird_sk_<your-key>',
          },
        },
        schemas: {
          Error: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              error: { type: 'string' },
              code: { type: 'string' },
              details: { type: 'object' },
            },
          },
          ServerType: {
            type: 'string',
            enum: ['STDIO', 'SSE', 'AWS_LAMBDA', 'EXECUTABLE'],
            description: 'The type of MCP server',
          },
          StdioServerConfig: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'Command to execute' },
              args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
              env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables' },
              cwd: { type: 'string', description: 'Working directory' },
            },
          },
          SseServerConfig: {
            type: 'object',
            properties: {
              url: { type: 'string', format: 'uri', description: 'SSE server URL' },
              headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'HTTP headers' },
            },
          },
          AwsLambdaServerConfig: {
            type: 'object',
            properties: {
              functionName: { type: 'string', description: 'Lambda function name' },
              region: { type: 'string', description: 'AWS region' },
              credentials: {
                type: 'object',
                properties: {
                  accessKeyId: { type: 'string' },
                  secretAccessKey: { type: 'string' },
                },
              },
            },
          },
          ExecutableServerConfig: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Path to executable' },
              args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
              env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Environment variables' },
            },
          },
          CreateServerRequest: {
            type: 'object',
            required: ['name', 'type'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 100, description: 'Server name' },
              type: { $ref: '#/components/schemas/ServerType' },
              config: { oneOf: [
                { $ref: '#/components/schemas/StdioServerConfig' },
                { $ref: '#/components/schemas/SseServerConfig' },
                { $ref: '#/components/schemas/AwsLambdaServerConfig' },
                { $ref: '#/components/schemas/ExecutableServerConfig' },
              ]},
              description: { type: 'string', description: 'Server description' },
            },
          },
          UpdateServerRequest: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 100, description: 'Server name' },
              config: { oneOf: [
                { $ref: '#/components/schemas/StdioServerConfig' },
                { $ref: '#/components/schemas/SseServerConfig' },
                { $ref: '#/components/schemas/AwsLambdaServerConfig' },
                { $ref: '#/components/schemas/ExecutableServerConfig' },
              ]},
              description: { type: 'string', description: 'Server description' },
            },
          },
          DeploymentType: {
            type: 'string',
            enum: ['LOCAL_PROCESS', 'DOCKER_COMPOSE'],
            description: 'The type of deployment',
          },
          ApiKeyPermissions: {
            type: 'object',
            properties: {
              serverIds: {
                type: 'array',
                items: { type: 'string' },
                description: 'Allowed server IDs (null for all servers)',
                nullable: true,
              },
            },
          },
          CreateApiKeyRequest: {
            type: 'object',
            required: ['name', 'permissions'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 100, description: 'API key name' },
              permissions: { $ref: '#/components/schemas/ApiKeyPermissions' },
            },
          },
        },
      },
    },
  });

  // Register Swagger UI
  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (swaggerObject) => {
      return swaggerObject;
    },
    transformSpecificationClone: true,
  });

  // Register routes
  await fastify.register(serverRoutes, { prefix: '/api' });
  await fastify.register(keyRoutes, { prefix: '/api' });

  // Register request ID header hook (must be before request logger)
  fastify.addHook('onRequest', requestIdHook);

  // Register request logger (before routes)
  fastify.addHook('onRequest', requestLoggerHook);

  // Add Prisma to request and instance context
  fastify.addHook('onRequest', async (request) => {
    request.prisma = prisma;
  });

  // Also add to instance for use in route handlers
  fastify.prisma = prisma;

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    const context: RequestLogContext = {
      requestId: String(request.id),
      method: request.method,
      url: request.url,
      ip: request.ip,
    };
    logError(error, context);

    if (error instanceof GirdError) {
      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
        success: false,
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
        success: false,
      });
      return;
    }

    // Generic error
    reply.code(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      success: false,
    });
  });

  // Not found handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Not found',
      code: 'NOT_FOUND',
      path: request.url,
      success: false,
    });
  });

  // Health check
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

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
    logger.info(`Swagger UI available at http://${host}:${port}/docs`);
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
