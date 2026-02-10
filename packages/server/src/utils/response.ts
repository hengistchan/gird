/**
 * Response utilities for standardized API responses
 */

import type {
  ApiResponse,
  PaginatedResponse,
} from '@gird/core';

/**
 * Create a standard success response
 */
export function success<T>(data: T): ApiResponse<T> {
  return { data, success: true };
}

/**
 * Create a paginated response object
 */
export function paginated<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / pageSize);

  return {
    data: items,
    meta: {
      page,
      pageSize,
      total,
      totalPages,
    },
    success: true,
  };
}

/**
 * Create a resource created response (includes message)
 */
export function created<T>(data: T, resource: string): ApiResponse<T> & {
  message: string;
} {
  return {
    data,
    success: true,
    message: `${resource} created successfully`,
  };
}

/**
 * Create a resource updated response (includes message)
 */
export function updated<T>(data: T, resource: string): ApiResponse<T> & {
  message: string;
} {
  return {
    data,
    success: true,
    message: `${resource} updated successfully`,
  };
}

/**
 * Create a deletion response
 */
export function deleted(resource: string): ApiResponse<null> & {
  message: string;
} {
  return {
    data: null,
    success: true,
    message: `${resource} deleted successfully`,
  };
}

/**
 * Create a deployment started response
 */
export function deploymentStarted(deployment: {
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
}): ApiResponse<{ deployment: typeof deployment }> & {
  message: string;
} {
  return {
    data: { deployment },
    success: true,
    message: 'Deployment started successfully',
  };
}

/**
 * Create a deployment stopped response
 */
export function deploymentStopped(): ApiResponse<{ success: true }> & {
  message: string;
} {
  return {
    data: { success: true },
    success: true,
    message: 'Deployment stopped successfully',
  };
}
