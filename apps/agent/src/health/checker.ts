/**
 * Health check implementation
 */

import type { HealthCheckConfig, HealthCheckResult } from '@gird/core';
import { getPrisma } from '@gird/core';
import type { HealthCheckScheduler } from './types.js';

export class HealthChecker implements HealthCheckScheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private consecutiveFailures = new Map<string, number>();

  /**
   * Start health checks for a deployment
   */
  start(deploymentId: string, config: HealthCheckConfig): void {
    // Stop any existing checks
    this.stop(deploymentId);

    // Reset consecutive failures
    this.consecutiveFailures.set(deploymentId, 0);

    // Set up interval
    const timer = setInterval(async () => {
      const prisma = getPrisma();
      const result = await this.checkHealth(deploymentId, config, prisma);
      await this.saveResult(deploymentId, result, prisma);

      // Track consecutive failures
      const currentFailures = this.consecutiveFailures.get(deploymentId) ?? 0;

      if (result.status === 'unhealthy') {
        this.consecutiveFailures.set(deploymentId, currentFailures + 1);

        // Trigger auto-restart if threshold reached
        if (currentFailures + 1 >= config.retries) {
          await this.handleUnhealthy(deploymentId);
        }
      } else {
        this.consecutiveFailures.set(deploymentId, 0);
      }
    }, config.interval * 1000);

    this.timers.set(deploymentId, timer);
  }

  /**
   * Stop health checks for a deployment
   */
  stop(deploymentId: string): void {
    const timer = this.timers.get(deploymentId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(deploymentId);
      this.consecutiveFailures.delete(deploymentId);
    }
  }

  /**
   * Check if health checks are running for a deployment
   */
  isRunning(deploymentId: string): boolean {
    return this.timers.has(deploymentId);
  }

  /**
   * Stop all health checks
   */
  stopAll(): void {
    for (const deploymentId of this.timers.keys()) {
      this.stop(deploymentId);
    }
  }

  /**
   * Perform a single health check
   */
  private async checkHealth(deploymentId: string, config: HealthCheckConfig, prisma: ReturnType<typeof getPrisma>): Promise<HealthCheckResult> {
    const startTime = Date.now();

    try {
      // Get deployment details
      const deployment = await prisma.deployment.findUnique({
        where: { id: deploymentId },
        include: { server: true },
      });

      if (!deployment) {
        return {
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          message: 'Deployment not found',
          checkedAt: new Date(),
        };
      }

      if (deployment.status !== 'RUNNING') {
        return {
          status: 'unhealthy',
          responseTime: Date.now() - startTime,
          message: `Deployment status is ${deployment.status}`,
          checkedAt: new Date(),
        };
      }

      // Perform HTTP check if endpoint configured
      if (config.endpoint) {
        const url = config.endpoint.startsWith('http')
          ? config.endpoint
          : `http://${deployment.host ?? '127.0.0.1'}:${deployment.port ?? 3000}${config.endpoint}`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(config.timeout),
          method: 'GET',
        });

        const responseTime = Date.now() - startTime;

        // Check status code
        if (config.expectedStatus && response.status !== config.expectedStatus) {
          return {
            status: 'unhealthy',
            responseTime,
            message: `Expected status ${config.expectedStatus}, got ${response.status}`,
            checkedAt: new Date(),
          };
        }

        // Check response body if configured
        if (config.expectedBody) {
          const text = await response.text();
          const matches = typeof config.expectedBody === 'string'
            ? text.includes(config.expectedBody)
            : config.expectedBody.test(text);

          if (!matches) {
            return {
              status: 'degraded',
              responseTime,
              message: 'Response body does not match expected pattern',
              checkedAt: new Date(),
            };
          }
        }

        return {
          status: 'healthy',
          responseTime,
          message: 'OK',
          checkedAt: new Date(),
        };
      }

      // Default health check based on deployment status
      return {
        status: 'healthy',
        responseTime: Date.now() - startTime,
        message: 'Deployment is running',
        checkedAt: new Date(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: error instanceof Error ? error.message : 'Unknown error',
        checkedAt: new Date(),
      };
    }
  }

  /**
   * Save health check result to database
   */
  private async saveResult(deploymentId: string, result: HealthCheckResult, prisma: ReturnType<typeof getPrisma>): Promise<void> {
    await prisma.healthCheck.create({
      data: {
        deploymentId,
        status: result.status,
        responseTime: result.responseTime,
        message: result.message ?? null,
        checkedAt: result.checkedAt,
      },
    });
  }

  /**
   * Handle unhealthy deployment - trigger auto-restart
   */
  private async handleUnhealthy(deploymentId: string): Promise<void> {
    const prisma = getPrisma();
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { server: true },
    });

    if (!deployment) return;

    const config = deployment.server.config as { restartPolicy?: { enabled: boolean; maxRetries: number } | null };

    // Only restart if auto-restart is enabled
    if (config?.restartPolicy?.enabled) {
      console.log(`Deployment ${deploymentId} is unhealthy, attempting restart...`);

      // Import here to avoid circular dependency - use the singleton instance
      const { autoRestartManager } = await import('./auto-restart.js');
      await autoRestartManager.handleCrash(deploymentId);
    }
  }
}

// Export singleton instance
export const healthChecker = new HealthChecker();
