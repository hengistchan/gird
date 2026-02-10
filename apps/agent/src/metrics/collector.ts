/**
 * Metrics collector - aggregates metrics from database and stores them
 */

import type { MetricLabel } from '@gird/core';
import { getPrisma } from '@gird/core';

/**
 * Store a metric in the database
 */
export async function storeMetric(
  name: string,
  value: number,
  labels: MetricLabel,
  tenantId?: string
): Promise<void> {
  const prisma = getPrisma();
  await prisma.metric.create({
    data: {
      tenantId: tenantId ?? null,
      name,
      value,
      labels: labels as never,
    },
  });
}

/**
 * Get metrics for a time range
 */
export async function getMetrics(
  name: string,
  startDate: Date,
  endDate: Date,
  tenantId?: string
): Promise<Array<{ timestamp: Date; value: number; labels: MetricLabel }>> {
  const prisma = getPrisma();
  const metrics = await prisma.metric.findMany({
    where: {
      name,
      tenantId: tenantId ?? null,
      timestamp: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: {
      timestamp: 'asc',
    },
  });

  return metrics.map((m) => ({
    timestamp: m.timestamp,
    value: m.value,
    labels: m.labels as MetricLabel,
  }));
}

/**
 * Aggregate metrics by label
 */
export async function aggregateMetricsByLabel(
  name: string,
  labelKey: string,
  startDate: Date,
  endDate: Date,
  tenantId?: string
): Promise<Record<string, number>> {
  const metrics = await getMetrics(name, startDate, endDate, tenantId);

  const result: Record<string, number> = {};

  for (const metric of metrics) {
    const labelValue = String(metric.labels[labelKey] ?? 'unknown');
    result[labelValue] = (result[labelValue] ?? 0) + metric.value;
  }

  return result;
}

/**
 * Get metric statistics for a time range
 */
export async function getMetricStats(
  name: string,
  startDate: Date,
  endDate: Date,
  tenantId?: string
): Promise<{ min: number; max: number; avg: number; count: number }> {
  const metrics = await getMetrics(name, startDate, endDate, tenantId);

  if (metrics.length === 0) {
    return { min: 0, max: 0, avg: 0, count: 0 };
  }

  const values = metrics.map((m) => m.value);
  const sum = values.reduce((a, b) => a + b, 0);

  return {
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length,
    count: values.length,
  };
}

/**
 * Delete old metrics (for cleanup)
 */
export async function deleteOldMetrics(beforeDate: Date, tenantId?: string): Promise<number> {
  const prisma = getPrisma();
  const result = await prisma.metric.deleteMany({
    where: {
      tenantId: tenantId ?? null,
      timestamp: {
        lt: beforeDate,
      },
    },
  });

  return result.count;
}

/**
 * Get current metric counts (for dashboards)
 */
export async function getMetricCounts(tenantId?: string): Promise<{
  totalServers: number;
  runningDeployments: number;
  totalRequests: number;
  healthyDeployments: number;
}> {
  const prisma = getPrisma();
  const [totalServers, runningDeployments, totalRequests, healthyDeployments] = await Promise.all([
    prisma.server.count({ where: { tenantId: tenantId ?? null } }),
    prisma.deployment.count({
      where: { status: 'RUNNING', server: { tenantId: tenantId ?? null } },
    }),
    // Get request count from metrics (last 24 hours)
    prisma.metric.count({
      where: {
        name: 'mcp_requests_total',
        tenantId: tenantId ?? null,
        timestamp: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    }),
    prisma.healthCheck.count({
      where: {
        status: 'healthy',
        deployment: { server: { tenantId: tenantId ?? null } },
        checkedAt: {
          gte: new Date(Date.now() - 5 * 60 * 1000), // Last 5 minutes
        },
      },
    }),
  ]);

  return {
    totalServers,
    runningDeployments,
    totalRequests,
    healthyDeployments,
  };
}
