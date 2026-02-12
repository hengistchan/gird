/**
 * Health check types and configuration
 */

import type { HealthCheckConfig } from '@gird-mcp/core';

export interface HealthCheckScheduler {
  start(deploymentId: string, config: HealthCheckConfig): void;
  stop(deploymentId: string): void;
  isRunning(deploymentId: string): boolean;
  stopAll(): void;
}

export interface AutoRestartManager {
  handleCrash(deploymentId: string): Promise<void>;
  handleUnhealthy(deploymentId: string): Promise<void>;
  resetRetryCount(deploymentId: string): Promise<void>;
}
