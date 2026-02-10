/**
 * API routes for server management
 */

import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { ValidationError, NotFoundError, DeploymentError } from '@gird/core';
import { createLogger, getConfig } from '@gird/core';
import {
  CreateServerSchema,
  UpdateServerSchema,
  IdParamsSchema,
} from '../schemas.js';
import { authHook } from '../middleware/auth.js';

const logger = createLogger('api:servers');

/**
 * Get agent URL for making requests to the agent service
 */
function getAgentUrl(): string {
  const config = getConfig();
  return `http://${config.agent.host}:${config.agent.port}`;
}

export async function serverRoutes(fastify: FastifyInstance) {
  const prisma = fastify.prisma as PrismaClient;

  // List all servers - requires authentication
  fastify.get('/servers', {
    onRequest: authHook,
  }, async (_request, _reply) => {
    const servers = await prisma.server.findMany({
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        status: s.status,
        description: s.description,
        currentDeployment: s.deployments[0] || null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  });

  // Get a specific server - requires authentication
  fastify.get('/servers/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    const server = await prisma.server.findUnique({
      where: { id },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    return {
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        status: server.status,
        description: server.description,
        config: server.config,
        deployments: server.deployments.map((d) => ({
          id: d.id,
          type: d.type,
          status: d.status,
          port: d.port,
          host: d.host,
          containerId: d.containerId,
          pid: d.pid,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      },
    };
  });

  // Create a new server - requires authentication
  fastify.post('/servers', {
    onRequest: authHook,
  }, async (request, reply) => {
    const data = CreateServerSchema.parse(request.body);

    // Check if server with same name exists
    const existing = await prisma.server.findUnique({
      where: { name: data.name },
    });

    if (existing) {
      throw new ValidationError(`Server with name '${data.name}' already exists`);
    }

    const server = await prisma.server.create({
      data: {
        name: data.name,
        type: data.type,
        config: data.config ?? {},
        description: data.description ?? null,
      },
    });

    logger.info(`Created server: ${server.name} (${server.id})`);

    reply.status(201).send({
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        status: server.status,
        description: server.description,
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      },
    });
  });

  // Update a server - requires authentication
  fastify.put('/servers/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const data = UpdateServerSchema.parse(request.body);

    // Check if server exists
    const existing = await prisma.server.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError('Server', id);
    }

    // Check if new name conflicts with another server
    if (data.name && data.name !== existing.name) {
      const nameConflict = await prisma.server.findUnique({
        where: { name: data.name },
      });

      if (nameConflict) {
        throw new ValidationError(`Server with name '${data.name}' already exists`);
      }
    }

    const server = await prisma.server.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.config !== undefined && { config: data.config }),
        ...(data.description !== undefined && { description: data.description }),
      },
    });

    logger.info(`Updated server: ${server.name} (${server.id})`);

    return {
      server: {
        id: server.id,
        name: server.name,
        type: server.type,
        status: server.status,
        description: server.description,
        createdAt: server.createdAt.toISOString(),
        updatedAt: server.updatedAt.toISOString(),
      },
    };
  });

  // Delete a server - requires authentication
  fastify.delete('/servers/:id', {
    onRequest: authHook,
  }, async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    // Check if server exists
    const existing = await prisma.server.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError('Server', id);
    }

    await prisma.server.delete({
      where: { id },
    });

    logger.info(`Deleted server: ${existing.name} (${id})`);

    reply.status(204).send();
  });

  // Start server deployment - requires authentication
  fastify.post('/servers/:id/start', {
    onRequest: authHook,
  }, async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = request.body as { type?: string; config?: Record<string, unknown> };

    // Check if server exists
    const server = await prisma.server.findUnique({
      where: { id },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    try {
      // Call the agent's deployment start endpoint
      const agentUrl = getAgentUrl();
      const url = `${agentUrl}/deployments/${id}/start`;

      logger.debug(`Starting deployment via agent`, { url, serverId: id, type: body.type });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: body.type,
          config: body.config,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error from agent',
        })) as Record<string, unknown>;
        logger.error(`Agent returned error for deployment start`, undefined, {
          responseStatus: response.status,
          errorData,
        });

        throw new DeploymentError(
          (errorData.error as string) || `Failed to start deployment: ${response.statusText}`,
          errorData
        );
      }

      const data = await response.json() as {
        success: boolean;
        deployment: {
          id: string;
          serverId: string;
          type: string;
          status: string;
          port: number;
          host: string;
          containerId: string | null;
          pid: number | null;
          createdAt: string;
          updatedAt: string;
        };
      };

      if (!data.success || !data.deployment) {
        throw new DeploymentError('Deployment start was not successful');
      }

      logger.info(`Successfully started deployment for server: ${server.name}`, {
        deploymentId: data.deployment.id,
        type: data.deployment.type,
        port: data.deployment.port,
      });

      // Return the deployment information
      return reply.send({
        deployment: {
          id: data.deployment.id,
          serverId: data.deployment.serverId,
          type: data.deployment.type,
          status: data.deployment.status,
          port: data.deployment.port,
          host: data.deployment.host,
          containerId: data.deployment.containerId,
          pid: data.deployment.pid,
          createdAt: data.deployment.createdAt,
          updatedAt: data.deployment.updatedAt,
        },
      });
    } catch (error) {
      // Re-throw known errors
      if (error instanceof DeploymentError || error instanceof NotFoundError) {
        throw error;
      }

      // Log and wrap unexpected errors
      logger.error('Failed to start deployment via agent', error as Error, { serverId: id });

      throw new DeploymentError(
        `Failed to start deployment: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  });

  // Stop server deployment - requires authentication
  fastify.post('/servers/:id/stop', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    // Check if server exists
    const server = await prisma.server.findUnique({
      where: { id },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    try {
      // Call the agent's deployment stop endpoint
      const agentUrl = getAgentUrl();
      const url = `${agentUrl}/deployments/${id}/stop`;

      logger.debug(`Stopping deployment via agent`, { url, serverId: id });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({
          error: 'Unknown error from agent',
        })) as Record<string, unknown>;
        logger.error(`Agent returned error for deployment stop`, undefined, {
          responseStatus: response.status,
          errorData,
        });

        throw new DeploymentError(
          (errorData.error as string) || `Failed to stop deployment: ${response.statusText}`,
          errorData
        );
      }

      const data = await response.json() as {
        success: boolean;
        message: string;
      };

      if (!data.success) {
        throw new DeploymentError('Deployment stop was not successful');
      }

      logger.info(`Successfully stopped deployment for server: ${server.name}`);

      // Return success response
      return {
        success: true,
        message: data.message || 'Deployment stopped successfully',
      };
    } catch (error) {
      // Re-throw known errors
      if (error instanceof DeploymentError || error instanceof NotFoundError) {
        throw error;
      }

      // Log and wrap unexpected errors
      logger.error('Failed to stop deployment via agent', error as Error, { serverId: id });

      throw new DeploymentError(
        `Failed to stop deployment: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  });

  // Get server logs - requires authentication
  fastify.get('/servers/:id/logs', {
    onRequest: authHook,
  }, async (request, reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const query = request.query as { tail?: string };

    // Check if server exists
    const server = await prisma.server.findUnique({
      where: { id },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    try {
      // Call the agent's deployment logs endpoint
      const agentUrl = getAgentUrl();
      const tail = query.tail ?? '100';
      const url = `${agentUrl}/deployments/${id}/logs?tail=${tail}`;

      logger.debug(`Fetching logs from agent`, { url });

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Agent returned error for logs`, undefined, {
          responseStatus: response.status,
          errorText,
        });

        // Return a meaningful error response
        return reply.code(response.status).send({
          error: `Failed to retrieve logs from agent: ${errorText}`,
          serverId: id,
        });
      }

      const data = await response.json() as { success: boolean; logs: string; tail: number };

      // Return the logs in the expected format
      return reply.send({
        success: true,
        logs: data.logs,
        tail: data.tail,
        serverId: id,
      });
    } catch (error) {
      logger.error('Failed to fetch logs from agent', error as Error, { serverId: id });

      return reply.code(500).send({
        error: `Failed to retrieve logs: ${(error as Error).message}`,
        serverId: id,
      });
    }
  });
}
