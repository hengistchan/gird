/**
 * Prometheus metrics registry
 */

import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

// Create a custom registry
export const registry = new Registry();

// Collect default metrics (CPU, memory, etc.)
collectDefaultMetrics({ register: registry });

// ============================================================================
// Deployment Metrics
// ============================================================================

export const deploymentUptime = new Gauge({
  name: 'gird_deployment_uptime_seconds',
  help: 'Deployment uptime in seconds',
  labelNames: ['deployment_id', 'server_name', 'type', 'tenant_id'] as const,
  registers: [registry],
});

export const deploymentStatus = new Gauge({
  name: 'gird_deployment_status',
  help: 'Current deployment status (1=running, 0=stopped, -1=error)',
  labelNames: ['deployment_id', 'server_name', 'type', 'tenant_id'] as const,
  registers: [registry],
});

export const deploymentRestarts = new Counter({
  name: 'gird_deployment_restarts_total',
  help: 'Total number of deployment restarts',
  labelNames: ['deployment_id', 'server_name', 'tenant_id'] as const,
  registers: [registry],
});

// ============================================================================
// MCP Request Metrics
// ============================================================================

export const mcpRequestsTotal = new Counter({
  name: 'gird_mcp_requests_total',
  help: 'Total number of MCP requests proxied',
  labelNames: ['server_id', 'method', 'status', 'tenant_id'] as const,
  registers: [registry],
});

export const mcpRequestDuration = new Histogram({
  name: 'gird_mcp_request_duration_seconds',
  help: 'MCP request duration in seconds',
  labelNames: ['server_id', 'method', 'status', 'tenant_id'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ============================================================================
// Health Check Metrics
// ============================================================================

export const healthCheckStatus = new Gauge({
  name: 'gird_health_check_status',
  help: 'Health check status (1=healthy, 0=unhealthy, -1=degraded)',
  labelNames: ['deployment_id', 'server_name', 'tenant_id'] as const,
  registers: [registry],
});

export const healthCheckResponseTime = new Gauge({
  name: 'gird_health_check_response_time_ms',
  help: 'Health check response time in milliseconds',
  labelNames: ['deployment_id', 'server_name', 'tenant_id'] as const,
  registers: [registry],
});

export const healthCheckFailures = new Counter({
  name: 'gird_health_check_failures_total',
  help: 'Total number of health check failures',
  labelNames: ['deployment_id', 'server_name', 'tenant_id'] as const,
  registers: [registry],
});

// ============================================================================
// API Key Metrics
// ============================================================================

export const apiKeyRequests = new Counter({
  name: 'gird_api_key_requests_total',
  help: 'Total number of requests per API key',
  labelNames: ['api_key_id', 'tenant_id'] as const,
  registers: [registry],
});

export const apiKeyAuthFailures = new Counter({
  name: 'gird_api_key_auth_failures_total',
  help: 'Total number of API key authentication failures',
  labelNames: ['tenant_id'] as const,
  registers: [registry],
});

// ============================================================================
// Server Metrics
// ============================================================================

export const serverCount = new Gauge({
  name: 'gird_server_count',
  help: 'Total number of servers',
  labelNames: ['type', 'status', 'tenant_id'] as const,
  registers: [registry],
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Set deployment uptime metric
 */
export function setDeploymentUptime(
  deploymentId: string,
  serverName: string,
  type: string,
  tenantId: string | null,
  uptimeSeconds: number
): void {
  deploymentUptime.set(
    { deployment_id: deploymentId, server_name: serverName, type, tenant_id: tenantId ?? 'none' },
    uptimeSeconds
  );
}

/**
 * Set deployment status metric
 */
export function setDeploymentStatus(
  deploymentId: string,
  serverName: string,
  type: string,
  tenantId: string | null,
  status: string
): void {
  const value = status === 'RUNNING' ? 1 : status === 'STOPPED' ? 0 : -1;
  deploymentStatus.set(
    { deployment_id: deploymentId, server_name: serverName, type, tenant_id: tenantId ?? 'none' },
    value
  );
}

/**
 * Increment MCP request counter
 */
export function incrementMcpRequest(
  serverId: string,
  method: string,
  status: string,
  tenantId: string | null
): void {
  mcpRequestsTotal.inc(
    { server_id: serverId, method, status, tenant_id: tenantId ?? 'none' }
  );
}

/**
 * Record MCP request duration
 */
export function observeMcpRequestDuration(
  serverId: string,
  method: string,
  status: string,
  tenantId: string | null,
  durationSeconds: number
): void {
  mcpRequestDuration.observe(
    { server_id: serverId, method, status, tenant_id: tenantId ?? 'none' },
    durationSeconds
  );
}

/**
 * Set health check status
 */
export function setHealthCheckStatus(
  deploymentId: string,
  serverName: string,
  tenantId: string | null,
  status: string
): void {
  const value = status === 'healthy' ? 1 : status === 'unhealthy' ? 0 : -1;
  healthCheckStatus.set(
    { deployment_id: deploymentId, server_name: serverName, tenant_id: tenantId ?? 'none' },
    value
  );
}

/**
 * Record health check response time
 */
export function setHealthCheckResponseTime(
  deploymentId: string,
  serverName: string,
  tenantId: string | null,
  responseTimeMs: number
): void {
  healthCheckResponseTime.set(
    { deployment_id: deploymentId, server_name: serverName, tenant_id: tenantId ?? 'none' },
    responseTimeMs
  );
}

/**
 * Increment health check failures
 */
export function incrementHealthCheckFailures(
  deploymentId: string,
  serverName: string,
  tenantId: string | null
): void {
  healthCheckFailures.inc(
    { deployment_id: deploymentId, server_name: serverName, tenant_id: tenantId ?? 'none' }
  );
}

/**
 * Clear all metrics (useful for testing)
 */
export function clearAllMetrics(): void {
  registry.clear();
}
