/**
 * Request proxy for forwarding to MCP servers
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DeploymentType, McpRequest, McpResponse, StdioServerConfig } from '@gird/core';
import {
  ProxyError,
  NotFoundError,
  DeploymentError,
  createTimeoutSignal,
  DEFAULT_TIMEOUTS,
  asServerConfig,
  isSseServerConfig,
  isStdioServerConfig,
} from '@gird/core';
import { createLogger } from '@gird/core';
import { stdioProcessPool } from './stdio/index.js';

const logger = createLogger('proxy');

// Timeout for proxy requests (30 seconds)
const PROXY_TIMEOUT = DEFAULT_TIMEOUTS.PROXY_REQUEST;

/**
 * Get the deployment details for a server
 */
async function getDeployment(prisma: PrismaClient, serverId: string): Promise<{
  type: DeploymentType;
  host: string | null;
  port: number | null;
  containerId: string | null;
  pid: number | null;
}> {
  // Find active deployment for the server
  const deployment = await prisma.deployment.findFirst({
    where: {
      serverId,
      status: 'RUNNING',
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (!deployment) {
    throw new NotFoundError('deployment', `running deployment for server ${serverId}`);
  }

  return {
    type: deployment.type as DeploymentType,
    host: deployment.host,
    port: deployment.port,
    containerId: deployment.containerId,
    pid: deployment.pid,
  };
}

/**
 * Proxy to an arbitrary URL (for SSE servers)
 */
async function proxyToUrl(
  req: FastifyRequest,
  reply: FastifyReply,
  url: string,
  headers?: Record<string, string>
): Promise<void> {
  logger.debug('Proxying request to URL', { url, method: req.method });

  try {
    // Build request init
    const init: RequestInit = {
      method: req.method,
      headers: {
        ...headers,
        ...(req.headers as Record<string, string>),
      },
    };

    // Only add body if present
    if (req.body) {
      init.body = JSON.stringify(req.body);
    }

    // Add timeout to prevent hanging requests
    init.signal = createTimeoutSignal(PROXY_TIMEOUT);

    // Forward the request
    const response = await fetch(url, init);

    // Set response headers
    const responseHeaders = response.headers;
    for (const [key, value] of responseHeaders.entries()) {
      if (key.toLowerCase() !== 'content-encoding') {
        reply.header(key, value);
      }
    }

    // Set status code
    reply.code(response.status);

    // Send response body
    const text = await response.text();
    reply.send(text);
  } catch (error) {
    logger.error('Failed to proxy request to URL', error instanceof Error ? error : undefined, { url });
    throw new ProxyError(`Failed to reach MCP server at ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Proxy to a local process or Docker container
 */
async function proxyToHttp(
  req: FastifyRequest,
  reply: FastifyReply,
  host: string,
  port: number,
  path: string
): Promise<void> {
  const url = `http://${host}:${port}${path}`;

  logger.debug('Proxying request', { url, method: req.method });

  try {
    // Build request init
    const init: RequestInit = {
      method: req.method,
      headers: req.headers as Record<string, string>,
    };

    // Only add body if present
    if (req.body) {
      init.body = JSON.stringify(req.body);
    }

    // Add timeout to prevent hanging requests
    init.signal = createTimeoutSignal(PROXY_TIMEOUT);

    // Forward the request
    const response = await fetch(url, init);

    // Set response headers
    const responseHeaders = response.headers;
    for (const [key, value] of responseHeaders.entries()) {
      if (key.toLowerCase() !== 'content-encoding') {
        reply.header(key, value);
      }
    }

    // Set status code
    reply.code(response.status);

    // Send response body
    const text = await response.text();
    reply.send(text);
  } catch (error) {
    logger.error('Failed to proxy request', error instanceof Error ? error : undefined, { url });
    throw new ProxyError(`Failed to reach MCP server at ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate MCP request format
 */
export function validateMcpRequest(body: unknown): McpRequest {
  if (!body || typeof body !== 'object') {
    throw new ProxyError('Invalid MCP request: request body must be a JSON-RPC object');
  }

  const req = body as Partial<McpRequest>;

  if (req.jsonrpc !== '2.0') {
    throw new ProxyError('Invalid MCP request: jsonrpc version must be "2.0"');
  }

  if (typeof req.id !== 'string' && typeof req.id !== 'number') {
    throw new ProxyError('Invalid MCP request: id must be a string or number');
  }

  if (typeof req.method !== 'string') {
    throw new ProxyError('Invalid MCP request: method must be a string');
  }

  return {
    jsonrpc: '2.0',
    id: req.id,
    method: req.method,
    params: req.params,
  };
}

/**
 * Create an MCP error response
 */
export function createMcpError(id: string | number, code: number, message: string, data?: unknown): McpResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  };
}

/**
 * Proxy to a STDIO process
 */
async function proxyToStdio(
  req: FastifyRequest,
  reply: FastifyReply,
  serverId: string,
  config: StdioServerConfig
): Promise<void> {
  logger.debug('Proxying request to STDIO process', { serverId, method: req.method });

  // Validate MCP request
  const mcpRequest = validateMcpRequest(req.body);

  try {
    // Send request through STDIO process pool
    const response = await stdioProcessPool.sendRequest(
      serverId,
      config,
      mcpRequest,
      PROXY_TIMEOUT
    );

    // Return MCP response
    reply.code(200).send(response);
  } catch (error) {
    logger.error('Failed to proxy to STDIO process', error instanceof Error ? error : undefined, { serverId });

    // Return MCP-formatted error
    reply.code(200).send(createMcpError(
      mcpRequest.id,
      -32603,
      error instanceof Error ? error.message : String(error)
    ));
  }
}

/**
 * Main proxy handler
 */
export async function proxyHandler(
  req: FastifyRequest & { prisma: PrismaClient },
  reply: FastifyReply
): Promise<void> {
  const { serverId } = req.params as { serverId: string };
  const { '*': path = '' } = req.params as { '*': string };

  logger.debug('Proxy request received', { serverId, path, method: req.method });

  try {
    // First, check if this is an SSE server by looking at server config
    const server = await req.prisma.server.findUnique({
      where: { id: serverId },
    });

    if (!server) {
      throw new NotFoundError('server', serverId);
    }

    // Parse and validate server config
    const serverConfig = asServerConfig(server.config);

    // For SSE servers, proxy directly to the configured URL
    if (isSseServerConfig(serverConfig)) {
      const sseUrl = serverConfig.url;
      // Add path to the base URL if needed
      const fullUrl = path ? `${sseUrl}/${path}` : sseUrl;
      await proxyToUrl(req, reply, fullUrl, serverConfig.headers);
      return;
    }

    // For STDIO servers, use STDIO proxy
    if (isStdioServerConfig(serverConfig)) {
      await proxyToStdio(req, reply, serverId, serverConfig);
      return;
    }

    // For other server types, get deployment details
    const deployment = await getDeployment(req.prisma, serverId);

    // For local process and Docker deployments, we expect an HTTP endpoint
    if (deployment.port === null) {
      throw new DeploymentError(`Server ${serverId} is not configured with a port`);
    }

    // Proxy to the server
    await proxyToHttp(req, reply, deployment.host ?? '127.0.0.1', deployment.port, '/' + path);
  } catch (error) {
    // For MCP protocol errors, return MCP-formatted error
    if (error instanceof ProxyError || error instanceof DeploymentError || error instanceof NotFoundError) {
      // If this looks like an MCP request, return MCP error format
      try {
        const mcpReq = validateMcpRequest(req.body);
        reply.code(200).send(createMcpError(mcpReq.id, -32603, error.message));
        return;
      } catch {
        // Not an MCP request, return regular error
      }

      reply.code(error.statusCode).send({
        error: error.message,
        code: error.code,
      });
      return;
    }

    throw error;
  }
}

/**
 * Health check handler
 */
export async function healthHandler(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.send({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}

/**
 * List available servers handler
 */
export async function listServersHandler(
  req: FastifyRequest & { prisma: PrismaClient },
  reply: FastifyReply
): Promise<void> {
  const servers = await req.prisma.server.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  reply.send({
    servers: servers.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}
