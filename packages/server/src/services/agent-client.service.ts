/**
 * Agent Client Service - Handles communication with the Agent server
 */

import { createLogger, getConfig, DeploymentError } from '@gird/core';

const logger = createLogger('service:agent-client');

export interface StartDeploymentOptions {
  type?: string;
  config?: Record<string, unknown>;
}

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
  success: boolean;
  deployment: DeploymentInfo;
}

export interface StopDeploymentResult {
  success: boolean;
  message: string;
}

export interface LogsResult {
  success: boolean;
  logs: string;
  tail: number;
}

export interface DeploymentStatusResult {
  serverId: string;
  status: string;
  deploymentId?: string;
  port?: number;
  host?: string;
}

export class AgentClientService {
  private baseUrl: string;
  private timeout: number;

  constructor(config?: { host?: string; port?: number | string; timeout?: number }) {
    const appConfig = getConfig();
    const host = config?.host ?? appConfig.agent.host;
    const port = config?.port ?? appConfig.agent.port;
    this.baseUrl = `http://${host}:${typeof port === 'string' ? port : String(port)}`;
    this.timeout = config?.timeout ?? 30000; // 30 seconds default
  }

  /**
   * Start a deployment via the Agent server
   */
  async startDeployment(
    serverId: string,
    options?: StartDeploymentOptions
  ): Promise<StartDeploymentResult> {
    const url = `${this.baseUrl}/deployments/${serverId}/start`;

    logger.debug(`Starting deployment via agent`, { url, serverId, type: options?.type });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: options?.type,
          config: options?.config,
        }),
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({
          error: 'Unknown error from agent',
        }))) as Record<string, unknown>;

        logger.error(`Agent returned error for deployment start`, undefined, {
          responseStatus: response.status,
          errorData,
        });

        throw new DeploymentError(
          (errorData.error as string) || `Failed to start deployment: ${response.statusText}`,
          errorData
        );
      }

      const data = (await response.json()) as StartDeploymentResult;

      if (!data.success || !data.deployment) {
        throw new DeploymentError('Deployment start was not successful');
      }

      logger.info(`Successfully started deployment for server: ${serverId}`, {
        deploymentId: data.deployment.id,
        type: data.deployment.type,
        port: data.deployment.port,
      });

      return data;
    } catch (error) {
      if (error instanceof DeploymentError) {
        throw error;
      }

      logger.error('Failed to start deployment via agent', error as Error, { serverId });

      throw new DeploymentError(
        `Failed to start deployment: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }

  /**
   * Stop a deployment via the Agent server
   */
  async stopDeployment(serverId: string): Promise<StopDeploymentResult> {
    const url = `${this.baseUrl}/deployments/${serverId}/stop`;

    logger.debug(`Stopping deployment via agent`, { url, serverId });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({
          error: 'Unknown error from agent',
        }))) as Record<string, unknown>;

        logger.error(`Agent returned error for deployment stop`, undefined, {
          responseStatus: response.status,
          errorData,
        });

        throw new DeploymentError(
          (errorData.error as string) || `Failed to stop deployment: ${response.statusText}`,
          errorData
        );
      }

      const data = (await response.json()) as StopDeploymentResult;

      if (!data.success) {
        throw new DeploymentError('Deployment stop was not successful');
      }

      logger.info(`Successfully stopped deployment for server: ${serverId}`);

      return data;
    } catch (error) {
      if (error instanceof DeploymentError) {
        throw error;
      }

      logger.error('Failed to stop deployment via agent', error as Error, { serverId });

      throw new DeploymentError(
        `Failed to stop deployment: ${(error as Error).message}`,
        (error as Error).stack
      );
    }
  }

  /**
   * Get deployment logs via the Agent server
   */
  async getLogs(serverId: string, options: { tail?: number } = {}): Promise<LogsResult> {
    const params = new URLSearchParams();
    if (options.tail) {
      params.append('tail', String(options.tail));
    }

    const url = `${this.baseUrl}/deployments/${serverId}/logs${params.toString() ? `?${params}` : ''}`;

    logger.debug(`Fetching logs from agent`, { url });

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Agent returned error for logs`, undefined, {
          responseStatus: response.status,
          errorText,
        });

        throw new DeploymentError(
          `Failed to retrieve logs from agent: ${errorText}`
        );
      }

      const data = (await response.json()) as LogsResult;

      return data;
    } catch (error) {
      if (error instanceof DeploymentError) {
        throw error;
      }

      logger.error('Failed to fetch logs from agent', error as Error, { serverId });

      throw new DeploymentError(
        `Failed to retrieve logs: ${(error as Error).message}`
      );
    }
  }

  /**
   * Get deployment status via the Agent server
   */
  async getDeploymentStatus(serverId: string): Promise<DeploymentStatusResult> {
    const url = `${this.baseUrl}/deployments/${serverId}/status`;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Agent returned error for status`, undefined, {
          responseStatus: response.status,
          errorText,
        });

        throw new DeploymentError(
          `Failed to retrieve status from agent: ${errorText}`
        );
      }

      const data = (await response.json()) as DeploymentStatusResult;

      return data;
    } catch (error) {
      if (error instanceof DeploymentError) {
        throw error;
      }

      logger.error('Failed to fetch status from agent', error as Error, { serverId });

      throw new DeploymentError(
        `Failed to retrieve status: ${(error as Error).message}`
      );
    }
  }

  /**
   * Check if the Agent server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/health`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000), // Short timeout for health check
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
