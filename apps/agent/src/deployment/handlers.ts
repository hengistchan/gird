/**
 * Deployment management HTTP handlers for MCP servers
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DeploymentType, ServerConfig, StdioServerConfig, ExecutableServerConfig, ServerType } from '@gird/core';
import { NotFoundError, DeploymentError, ValidationError, asServerConfig, isSseServerConfig } from '@gird/core';
import { createLogger } from '@gird/core';
import { startLocalProcess, stopLocalProcess, getProcessStatus, getProcessLogs } from './local-process.js';
import { startDockerServer, stopDockerServer, getContainerStatus, getContainerLogs } from './docker-compose.js';

const logger = createLogger('deployment:handlers');

// Extend Fastify request type to include auth context
declare module 'fastify' {
  interface FastifyRequest {
    prisma: PrismaClient;
    apiKey?: {
      id: string;
      tenantId?: string;
    };
  }
}

interface DeploymentRequest {
  serverId: string;
}

interface StartDeploymentBody {
  type?: DeploymentType;
  config?: {
    port?: number;
    // Docker-specific options
    image?: string;
    ports?: Record<string, string>;
    environment?: Record<string, string>;
    volumes?: Record<string, string>;
    // Local process-specific options
    autoRestart?: boolean;
    logFile?: string;
  };
}

/**
 * Check if a server type requires deployment
 * SSE and AWS_LAMBDA servers are remote and don't need local deployment
 */
function requiresDeployment(serverType: ServerType): boolean {
  return serverType === 'STDIO' || serverType === 'EXECUTABLE';
}

/**
 * Helper function to get server configuration with validation
 */
async function getServerConfig(
  prisma: PrismaClient,
  serverId: string
): Promise<{ id: string; name: string; type: ServerType; config: ServerConfig }> {
  const server = await prisma.server.findUnique({
    where: { id: serverId },
  });

  if (!server) {
    throw new NotFoundError('server', serverId);
  }

  // Use type guard to validate config
  const config = asServerConfig(server.config);

  return {
    id: server.id,
    name: server.name,
    type: server.type as ServerType,
    config,
  };
}

/**
 * Start a deployment for a server
 */
export async function startDeploymentHandler(
  req: FastifyRequest<{ Params: DeploymentRequest; Body: StartDeploymentBody }>,
  reply: FastifyReply
): Promise<void> {
  const { serverId } = req.params;
  const apiKeyId = req.apiKey?.id;
  const ipAddress = req.headers['x-forwarded-for'] as string ?? req.ip ?? 'unknown';

  logger.info(`Starting deployment for server: ${serverId}`, { apiKeyId, ipAddress });

  try {
    // Get server configuration
    const server = await getServerConfig(req.prisma, serverId);

    // Check if this server type requires deployment
    // SSE and AWS_LAMBDA servers are remote - they don't need local deployment
    if (!requiresDeployment(server.type)) {
      logger.info(`Server ${server.name} (${server.type}) is a remote server type - marking as ACTIVE without deployment`);

      // Update server status to ACTIVE (remote servers are always "running" from our perspective)
      await req.prisma.server.update({
        where: { id: serverId },
        data: { status: 'ACTIVE' },
      });

      // For SSE servers, extract URL info for response
      let url: string | undefined;
      if (isSseServerConfig(server.config)) {
        url = server.config.url;
      }

      reply.code(200).send({
        success: true,
        deployment: {
          id: `remote-${serverId}`,
          serverId,
          type: 'REMOTE',
          status: 'RUNNING',
          message: `${server.type} servers are remote and do not require local deployment`,
          ...(url ? { url } : {}),
        },
      });
      return;
    }

    // Determine deployment type for local servers
    const deploymentType = req.body?.type ?? 'LOCAL_PROCESS';

    // Check if there's already a running deployment
    const existingDeployment = await req.prisma.deployment.findFirst({
      where: {
        serverId,
        status: 'RUNNING',
      },
    });

    if (existingDeployment) {
      // Check if it's actually still running
      let isActuallyRunning = false;
      if (existingDeployment.type === 'LOCAL_PROCESS') {
        const status = getProcessStatus(serverId);
        isActuallyRunning = status.running;
      } else if (existingDeployment.type === 'DOCKER_COMPOSE') {
        const status = await getContainerStatus(serverId);
        isActuallyRunning = status.running;
      }

      if (isActuallyRunning) {
        throw new DeploymentError(`Server ${server.name} is already running`);
      } else {
        // Update the existing deployment to STOPPED
        await req.prisma.deployment.update({
          where: { id: existingDeployment.id },
          data: { status: 'STOPPED' },
        });
      }
    }

    // Start the deployment based on type
    let deploymentResult: {
      pid?: number;
      containerId?: string;
      port: number;
    };

    if (deploymentType === 'DOCKER_COMPOSE') {
      // Docker Compose deployment
      const dockerConfig: {
        image?: string;
        ports?: Record<string, string>;
        environment?: Record<string, string>;
        volumes?: Record<string, string>;
      } = req.body?.config ?? {};
      const port = req.body?.config?.port;

      const result = await startDockerServer(
        serverId,
        server.name,
        {
          ...(dockerConfig.image ? { image: dockerConfig.image } : {}),
          ...(dockerConfig.ports ? { ports: dockerConfig.ports } : {}),
          ...(dockerConfig.environment ? { environment: dockerConfig.environment } : {}),
          ...(dockerConfig.volumes ? { volumes: dockerConfig.volumes } : {}),
        },
        port
      );

      deploymentResult = {
        containerId: result.containerId,
        port: result.port,
      };
    } else {
      // Local Process deployment
      const serverConfig = server.config as StdioServerConfig | ExecutableServerConfig;
      const port = req.body?.config?.port;

      const result = await startLocalProcess(serverId, server.name, serverConfig);

      deploymentResult = {
        pid: result.pid,
        port: port ?? 3000, // Default port if not specified
      };
    }

    // Create or update deployment record
    const deployment = await req.prisma.deployment.upsert({
      where: { id: `${serverId}-latest` },
      create: {
        id: `${serverId}-${Date.now()}`,
        serverId,
        type: deploymentType,
        status: 'RUNNING',
        port: deploymentResult.port,
        host: '127.0.0.1',
        containerId: deploymentResult.containerId ?? null,
        pid: deploymentResult.pid ?? null,
      },
      update: {
        type: deploymentType,
        status: 'RUNNING',
        port: deploymentResult.port,
        host: '127.0.0.1',
        containerId: deploymentResult.containerId ?? null,
        pid: deploymentResult.pid ?? null,
        updatedAt: new Date(),
      },
    });

    // Update server status
    await req.prisma.server.update({
      where: { id: serverId },
      data: { status: 'ACTIVE' },
    });

    logger.info(`Successfully started deployment for server: ${server.name}`, {
      deploymentId: deployment.id,
      type: deploymentType,
    });

    reply.code(200).send({
      success: true,
      deployment: {
        id: deployment.id,
        serverId: deployment.serverId,
        type: deployment.type,
        status: deployment.status,
        port: deployment.port,
        host: deployment.host,
        containerId: deployment.containerId,
        pid: deployment.pid,
        createdAt: deployment.createdAt.toISOString(),
        updatedAt: deployment.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    logger.error(`Failed to start deployment for server: ${serverId}`, undefined, { error });

    if (error instanceof NotFoundError || error instanceof DeploymentError || error instanceof ValidationError) {
      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    reply.code(500).send({
      error: 'Failed to start deployment',
      code: 'DEPLOYMENT_START_ERROR',
    });
  }
}

/**
 * Stop a deployment for a server
 */
export async function stopDeploymentHandler(
  req: FastifyRequest<{ Params: DeploymentRequest }>,
  reply: FastifyReply
): Promise<void> {
  const { serverId } = req.params;
  const apiKeyId = req.apiKey?.id;
  const ipAddress = req.headers['x-forwarded-for'] as string ?? req.ip ?? 'unknown';

  logger.info(`Stopping deployment for server: ${serverId}`, { apiKeyId, ipAddress });

  try {
    // Get the server configuration
    const server = await getServerConfig(req.prisma, serverId);

    // Check if this server type requires deployment
    // SSE and AWS_LAMBDA servers are remote - just mark as stopped
    if (!requiresDeployment(server.type)) {
      logger.info(`Server ${server.name} (${server.type}) is a remote server type - marking as STOPPED`);

      // Update server status to STOPPED
      await req.prisma.server.update({
        where: { id: serverId },
        data: { status: 'STOPPED' },
      });

      reply.code(200).send({
        success: true,
        message: `${server.type} server marked as stopped (no local deployment to stop)`,
      });
      return;
    }

    // Get the running deployment
    const deployment = await req.prisma.deployment.findFirst({
      where: {
        serverId,
        status: 'RUNNING',
      },
    });

    if (!deployment) {
      throw new NotFoundError('running deployment', `for server ${serverId}`);
    }

    // Stop the deployment based on type
    if (deployment.type === 'DOCKER_COMPOSE') {
      await stopDockerServer(serverId, server.name);
    } else {
      await stopLocalProcess(serverId, server.name);
    }

    // Update deployment status
    await req.prisma.deployment.update({
      where: { id: deployment.id },
      data: { status: 'STOPPED' },
    });

    // Update server status
    await req.prisma.server.update({
      where: { id: serverId },
      data: { status: 'STOPPED' },
    });

    logger.info(`Successfully stopped deployment for server: ${server.name}`, {
      deploymentId: deployment.id,
    });

    reply.code(200).send({
      success: true,
      message: `Deployment stopped successfully`,
    });
  } catch (error) {
    logger.error(`Failed to stop deployment for server: ${serverId}`, undefined, { error });

    if (error instanceof NotFoundError || error instanceof DeploymentError) {
      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    reply.code(500).send({
      error: 'Failed to stop deployment',
      code: 'DEPLOYMENT_STOP_ERROR',
    });
  }
}

/**
 * Get logs for a deployment
 */
export async function getLogsHandler(
  req: FastifyRequest<{ Params: DeploymentRequest; Querystring: { tail?: string } }>,
  reply: FastifyReply
): Promise<void> {
  const { serverId } = req.params;
  const tail = parseInt(req.query.tail ?? '100', 10);
  const apiKeyId = req.apiKey?.id;

  logger.debug(`Fetching logs for server: ${serverId}`, { apiKeyId, tail });

  try {
    // Get the running deployment
    const deployment = await req.prisma.deployment.findFirst({
      where: {
        serverId,
        status: 'RUNNING',
      },
    });

    if (!deployment) {
      throw new NotFoundError('running deployment', `for server ${serverId}`);
    }

    let logs: string;

    if (deployment.type === 'DOCKER_COMPOSE') {
      logs = await getContainerLogs(serverId, tail);
    } else {
      const logLines = getProcessLogs(serverId, tail);
      logs = logLines.join('\n');
    }

    reply.code(200).send({
      success: true,
      serverId,
      deploymentId: deployment.id,
      logs,
      tail,
    });
  } catch (error) {
    logger.error(`Failed to get logs for server: ${serverId}`, undefined, { error });

    if (error instanceof NotFoundError) {
      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    reply.code(500).send({
      error: 'Failed to retrieve logs',
      code: 'LOGS_FETCH_ERROR',
    });
  }
}

/**
 * Get deployment status for a server
 */
export async function getStatusHandler(
  req: FastifyRequest<{ Params: DeploymentRequest }>,
  reply: FastifyReply
): Promise<void> {
  const { serverId } = req.params;
  const apiKeyId = req.apiKey?.id;

  logger.debug(`Fetching status for server: ${serverId}`, { apiKeyId });

  try {
    // Get the server
    const server = await req.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new NotFoundError('server', serverId);
    }

    // Check if this is a remote server type (SSE or AWS_LAMBDA)
    const serverType = server.type as ServerType;
    const isRemote = !requiresDeployment(serverType);

    if (isRemote) {
      // For remote servers, return status based on server status
      // No deployment record exists for remote servers
      reply.code(200).send({
        success: true,
        serverId,
        serverName: server.name,
        serverType,
        serverStatus: server.status,
        deployment: {
          id: `remote-${serverId}`,
          type: 'REMOTE',
          status: server.status === 'ACTIVE' ? 'RUNNING' : 'STOPPED',
          message: `${serverType} servers are remote and do not have local deployments`,
        },
        runtimeStatus: {
          running: server.status === 'ACTIVE',
          type: serverType,
        },
      });
      return;
    }

    // Get the latest deployment for local servers
    const deployment = await req.prisma.deployment.findFirst({
      where: { serverId },
      orderBy: { createdAt: 'desc' },
    });

    if (!deployment) {
      reply.code(200).send({
        success: true,
        serverId,
        serverName: server.name,
        serverStatus: server.status,
        deployment: null,
        runtimeStatus: {
          running: false,
        },
      });
      return;
    }

    // Get actual runtime status
    let runtimeStatus: { running: boolean; pid?: number; containerId?: string; uptime?: number };

    if (deployment.type === 'DOCKER_COMPOSE') {
      const containerStatus = await getContainerStatus(serverId);
      runtimeStatus = {
        running: containerStatus.running,
        ...(containerStatus.containerId ? { containerId: containerStatus.containerId } : {}),
      };
    } else {
      const processStatus = getProcessStatus(serverId);
      runtimeStatus = {
        running: processStatus.running,
        ...(processStatus.pid !== undefined ? { pid: processStatus.pid } : {}),
        ...(processStatus.uptime !== undefined ? { uptime: processStatus.uptime } : {}),
      };
    }

    reply.code(200).send({
      success: true,
      serverId,
      serverName: server.name,
      serverStatus: server.status,
      deployment: {
        id: deployment.id,
        type: deployment.type,
        status: deployment.status,
        port: deployment.port,
        host: deployment.host,
        containerId: deployment.containerId,
        pid: deployment.pid,
        createdAt: deployment.createdAt.toISOString(),
        updatedAt: deployment.updatedAt.toISOString(),
      },
      runtimeStatus,
    });
  } catch (error) {
    logger.error(`Failed to get status for server: ${serverId}`, undefined, { error });

    if (error instanceof NotFoundError) {
      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
        details: error.details,
      });
      return;
    }

    reply.code(500).send({
      error: 'Failed to retrieve status',
      code: 'STATUS_FETCH_ERROR',
    });
  }
}
