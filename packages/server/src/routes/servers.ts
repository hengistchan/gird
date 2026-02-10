/**
 * API routes for server management
 */

import type { FastifyInstance } from 'fastify';
import { NotFoundError, DeploymentError, createTimeoutSignal, DEFAULT_TIMEOUTS } from '@gird/core';
import { createLogger, getConfig } from '@gird/core';
import {
  CreateServerSchema,
  UpdateServerSchema,
  IdParamsSchema,
  ServerQuerySchema,
} from '../schemas.js';
import { authHook } from '../middleware/auth.js';
import {
  success,
  paginated,
  created,
  updated,
  deleted as deletedResponse,
  deploymentStarted,
  deploymentStopped,
} from '../utils/response.js';
import { ServerService } from '../services/index.js';

const logger = createLogger('api:servers');

// Timeout for agent requests (30 seconds)
const AGENT_REQUEST_TIMEOUT = DEFAULT_TIMEOUTS.AGENT_REQUEST;

/**
 * Get agent URL for making requests to the agent service
 */
function getAgentUrl(): string {
  const config = getConfig();
  return `http://${config.agent.host}:${config.agent.port}`;
}

export async function serverRoutes(fastify: FastifyInstance) {
  // Initialize services
  const serverService = new ServerService();

  // List all servers - requires authentication
  fastify.get('/servers', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const query = ServerQuerySchema.parse(request.query);
    const { page, pageSize, type, status, search, sortBy, sortOrder } = query;

    const result = await serverService.list({
      includeDeployments: true,
      filters: {
        ...(type !== undefined && { type }),
        ...(status !== undefined && { status }),
        ...(search !== undefined && { search }),
      },
      pagination: {
        page,
        pageSize,
        sortBy,
        sortOrder,
      },
    });

    return paginated(result.items, result.page, result.pageSize, result.total);
  });

  // Get a specific server - requires authentication
  fastify.get('/servers/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    const server = await serverService.findById(id);

    return success({ server });
  });

  // Create a new server - requires authentication
  fastify.post('/servers', {
    onRequest: authHook,
  }, async (request, reply) => {
    const data = CreateServerSchema.parse(request.body);

    const server = await serverService.create({
      name: data.name,
      type: data.type,
      config: (data.config ?? {}) as any,
      ...(data.description !== undefined && { description: data.description }),
    });

    reply.status(201).send(created(server, 'Server'));
  });

  // Update a server - requires authentication
  fastify.put('/servers/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const data = UpdateServerSchema.parse(request.body);

    const server = await serverService.update(id, {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.config !== undefined && { config: data.config as any }),
      ...(data.description !== undefined && { description: data.description }),
    });

    return updated(server, 'Server');
  });

  // Delete a server - requires authentication
  fastify.delete('/servers/:id', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);

    await serverService.delete(id);

    return deletedResponse('Server');
  });

  // Start server deployment - requires authentication
  fastify.post('/servers/:id/start', {
    onRequest: authHook,
  }, async (request, _reply) => {
    const { id } = IdParamsSchema.parse(request.params);
    const body = request.body as { type?: string; config?: Record<string, unknown> };

    try {
      // Verify server exists before starting deployment
      const server = await serverService.findBasicById(id);

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
        signal: createTimeoutSignal(AGENT_REQUEST_TIMEOUT),
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

      return deploymentStarted({
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
      });
    } catch (error) {
      if (error instanceof DeploymentError || error instanceof NotFoundError) {
        throw error;
      }

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

    try {
      // Verify server exists before stopping deployment
      const server = await serverService.findBasicById(id);

      const agentUrl = getAgentUrl();
      const url = `${agentUrl}/deployments/${id}/stop`;

      logger.debug(`Stopping deployment via agent`, { url, serverId: id });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: createTimeoutSignal(AGENT_REQUEST_TIMEOUT),
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

      return deploymentStopped();
    } catch (error) {
      if (error instanceof DeploymentError || error instanceof NotFoundError) {
        throw error;
      }

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

    try {
      // Verify server exists before fetching logs
      await serverService.findBasicById(id);

      const agentUrl = getAgentUrl();
      const tail = query.tail ?? '100';
      const url = `${agentUrl}/deployments/${id}/logs?tail=${tail}`;

      logger.debug(`Fetching logs from agent`, { url });

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: createTimeoutSignal(AGENT_REQUEST_TIMEOUT),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Agent returned error for logs`, undefined, {
          responseStatus: response.status,
          errorText,
        });

        return reply.code(response.status).send({
          error: `Failed to retrieve logs from agent: ${errorText}`,
          serverId: id,
        });
      }

      const data = await response.json() as { success: boolean; logs: string; tail: number };

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
