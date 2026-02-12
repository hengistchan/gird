/**
 * Deployment Service - Business logic for deployment management
 * Coordinates between Server, API Server, and Agent Server
 */

import { createLogger } from '@gird-mcp/core';
import { AgentClientService, type StartDeploymentOptions } from './agent-client.service.js';
import { ServerService } from './server.service.js';

const logger = createLogger('service:deployment');

export interface DeploymentInfo {
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
}

export interface StartDeploymentResult {
  deployment: DeploymentInfo;
}

export interface StopDeploymentResult {
  success: boolean;
  message: string;
}

export class DeploymentService {
  private serverService: ServerService;
  private agentClient: AgentClientService;

  constructor(
    serverService?: ServerService,
    agentClient?: AgentClientService
  ) {
    this.serverService = serverService ?? new ServerService();
    this.agentClient = agentClient ?? new AgentClientService();
  }

  /**
   * Start a deployment for a server
   * Validates the server exists before delegating to the agent
   */
  async start(
    serverId: string,
    options?: StartDeploymentOptions
  ): Promise<StartDeploymentResult> {
    // Verify server exists
    const server = await this.serverService.findById(serverId);

    logger.info(`Starting deployment for server: ${server.name}`, {
      serverId,
      type: options?.type,
    });

    // Delegate to agent client
    const result = await this.agentClient.startDeployment(serverId, options);

    return {
      deployment: result.deployment,
    };
  }

  /**
   * Stop a deployment for a server
   * Validates the server exists before delegating to the agent
   */
  async stop(serverId: string): Promise<StopDeploymentResult> {
    // Verify server exists
    const server = await this.serverService.findById(serverId);

    logger.info(`Stopping deployment for server: ${server.name}`, { serverId });

    // Delegate to agent client
    const result = await this.agentClient.stopDeployment(serverId);

    return result;
  }

  /**
   * Get logs for a server's deployment
   */
  async getLogs(serverId: string, tail?: number): Promise<{ logs: string; tail: number }> {
    // Verify server exists
    const server = await this.serverService.findById(serverId);

    logger.debug(`Fetching logs for server: ${server.name}`, { serverId, tail });

    // Delegate to agent client
    const result = await this.agentClient.getLogs(serverId, {
      ...(tail !== undefined && { tail }),
    });

    return {
      logs: result.logs,
      tail: result.tail,
    };
  }

  /**
   * Get deployment status for a server
   */
  async getStatus(serverId: string): Promise<{
    serverId: string;
    status: string;
    deploymentId?: string;
    port?: number;
    host?: string;
  }> {
    // Verify server exists
    const server = await this.serverService.findById(serverId);

    logger.debug(`Fetching status for server: ${server.name}`, { serverId });

    // Delegate to agent client
    const result = await this.agentClient.getDeploymentStatus(serverId);

    return result;
  }
}
