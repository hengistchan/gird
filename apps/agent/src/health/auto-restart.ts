/**
 * Auto-restart manager for crashed deployments
 */

import { DeploymentError, logger, getPrisma, asServerConfig, isStdioServerConfig } from '@gird-mcp/core';
import type { RestartPolicy, ServerConfig } from '@gird-mcp/core';
import type { AutoRestartManager } from './types.js';

// Maximum number of retry attempts (fallback if policy doesn't specify)
const MAX_RETRIES = 5;

// Rate limiting constants
export const MAX_RESTARTS_PER_MINUTE = 3;
export const RESTART_TIME_WINDOW_MS = 60000; // 1 minute

// Track retry counts per deployment
const retryCounts = new Map<string, number>();

// Track restart timestamps for rate limiting per deployment
const restartTimestamps = new Map<string, number[]>();

/**
 * Clear all rate limit tracking (for testing purposes)
 */
export function clearAllRateLimits(): void {
  restartTimestamps.clear();
}

/**
 * Check if the deployment has exceeded the restart rate limit
 * Returns true if rate limit is exceeded, false otherwise
 */
export function isRateLimitExceeded(deploymentId: string): boolean {
  const now = Date.now();
  const timestamps = restartTimestamps.get(deploymentId) ?? [];

  // Filter to only timestamps within the time window
  const recentTimestamps = timestamps.filter(
    ts => now - ts < RESTART_TIME_WINDOW_MS
  );

  // Update the stored timestamps
  restartTimestamps.set(deploymentId, recentTimestamps);

  const restartCount = recentTimestamps.length;

  if (restartCount >= MAX_RESTARTS_PER_MINUTE) {
    logger.warn(
      `Rate limit exceeded for deployment ${deploymentId}: ${restartCount} restarts in the last ${RESTART_TIME_WINDOW_MS / 1000} seconds (max: ${MAX_RESTARTS_PER_MINUTE})`
    );
    return true;
  }

  // Add current timestamp to the list
  recentTimestamps.push(now);
  restartTimestamps.set(deploymentId, recentTimestamps);

  return false;
}

/**
 * Clear rate limit tracking for a deployment (called on successful restart)
 */
export function clearRateLimit(deploymentId: string): void {
  restartTimestamps.delete(deploymentId);
}

export class AutoRestartManagerImpl implements AutoRestartManager {
  /**
   * Handle a deployment crash or unhealthy state
   * Uses a loop-based approach instead of recursion to prevent stack overflow
   */
  async handleCrash(deploymentId: string): Promise<void> {
    const prisma = getPrisma();
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { server: true },
    });

    if (!deployment) {
      logger.error(`Deployment ${deploymentId} not found`);
      return;
    }

    // Type-safe config extraction using type guards
    const serverConfig = asServerConfig(deployment.server.config);

    // Extract restartPolicy from config if present
    const policy = (serverConfig as ServerConfig & {
      restartPolicy?: RestartPolicy | null;
    }).restartPolicy;

    if (!policy?.enabled) {
      logger.debug(`Auto-restart disabled for deployment ${deploymentId}`);
      await this.markFailed(deploymentId);
      return;
    }

    const effectiveMaxRetries = policy.maxRetries ?? MAX_RETRIES;
    let retryCount = retryCounts.get(deploymentId) ?? 0;

    // Check rate limit before attempting any restart
    if (isRateLimitExceeded(deploymentId)) {
      logger.error(
        `Auto-restart rate limit exceeded for deployment ${deploymentId}. Stopping auto-restart to prevent infinite restart loop.`
      );
      // Clean up tracking and mark as failed
      retryCounts.delete(deploymentId);
      clearRateLimit(deploymentId);
      await this.markFailed(deploymentId);
      return;
    }

    // Loop-based retry instead of recursion to prevent stack overflow
    while (retryCount < effectiveMaxRetries) {
      // Calculate backoff delay
      const backoffMs = Math.min(
        Math.pow(policy.backoffMultiplier ?? 2, retryCount) * 1000,
        (policy.maxBackoffSeconds ?? 60) * 1000
      );

      logger.info(
        `Restarting deployment ${deploymentId} in ${backoffMs}ms (retry ${retryCount + 1}/${effectiveMaxRetries})`
      );

      // Wait for backoff
      await this.sleep(backoffMs);

      // Attempt restart
      try {
        await this.restart(deploymentId);

        // Success - reset retry count and rate limit tracking, then exit
        retryCounts.delete(deploymentId);
        clearRateLimit(deploymentId);
        logger.info(`Deployment ${deploymentId} restarted successfully`);
        return;
      } catch (error) {
        retryCount++;
        retryCounts.set(deploymentId, retryCount);
        logger.error(
          `Failed to restart deployment ${deploymentId} (attempt ${retryCount}/${effectiveMaxRetries}):`,
          error instanceof Error ? error : new Error(String(error))
        );

        // Check rate limit after each failed attempt to prevent infinite loop
        if (isRateLimitExceeded(deploymentId)) {
          logger.error(
            `Auto-restart rate limit exceeded for deployment ${deploymentId} after ${retryCount} attempts. Stopping auto-restart.`
          );
          retryCounts.delete(deploymentId);
          clearRateLimit(deploymentId);
          await this.markFailed(deploymentId);
          return;
        }

        // Continue loop to retry with backoff
      }
    }

    // Max retries reached - mark as failed
    logger.error(
      `Max retries (${effectiveMaxRetries}) reached for deployment ${deploymentId}`
    );
    retryCounts.delete(deploymentId);
    clearRateLimit(deploymentId);
    await this.markFailed(deploymentId);
  }

  /**
   * Handle unhealthy deployment (alias for handleCrash)
   */
  async handleUnhealthy(deploymentId: string): Promise<void> {
    await this.handleCrash(deploymentId);
  }

  /**
   * Reset retry count for a deployment (called on successful health check)
   */
  async resetRetryCount(deploymentId: string): Promise<void> {
    retryCounts.delete(deploymentId);
    clearRateLimit(deploymentId);
  }

  /**
   * Restart a deployment
   */
  private async restart(deploymentId: string): Promise<void> {
    const prisma = getPrisma();
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { server: true },
    });

    if (!deployment) {
      throw new DeploymentError('Deployment not found');
    }

    // Stop the deployment
    if (deployment.type === 'DOCKER_COMPOSE') {
      // Stop Docker container
      const { stopDockerServer } = await import('../deployment/docker-compose.js');
      await stopDockerServer(deployment.serverId, deployment.server.name);
    } else if (deployment.type === 'LOCAL_PROCESS') {
      // Stop local process
      const { stopLocalProcess } = await import('../deployment/local-process.js');
      await stopLocalProcess(deployment.serverId, deployment.server.name);
    }

    // Update status to stopped
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'STOPPED' },
    });

    // Start the deployment again with properly typed config
    if (deployment.type === 'DOCKER_COMPOSE') {
      const { startDockerServer } = await import('../deployment/docker-compose.js');
      await startDockerServer(deployment.serverId, deployment.server.name, {}, deployment.port ?? undefined);
    } else if (deployment.type === 'LOCAL_PROCESS') {
      const { startLocalProcess } = await import('../deployment/local-process.js');
      // Use type guard to safely convert config
      const serverConfig = asServerConfig(deployment.server.config);
      if (isStdioServerConfig(serverConfig)) {
        await startLocalProcess(deployment.serverId, deployment.server.name, serverConfig);
      } else {
        throw new DeploymentError(`Invalid server config type for LOCAL_PROCESS deployment`);
      }
    }

    // Update status to running
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'RUNNING' },
    });

    logger.info(`Deployment ${deploymentId} restarted successfully`);
  }

  /**
   * Mark deployment as failed
   */
  private async markFailed(deploymentId: string): Promise<void> {
    const prisma = getPrisma();
    await prisma.deployment.update({
      where: { id: deploymentId },
      data: { status: 'ERROR' },
    });

    // Update server status as well
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
    });

    if (deployment) {
      await prisma.server.update({
        where: { id: deployment.serverId },
        data: { status: 'ERROR' },
      });
    }

    // Stop health checks
    const { healthChecker } = await import('./checker.js');
    healthChecker.stop(deploymentId);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const autoRestartManager = new AutoRestartManagerImpl();
