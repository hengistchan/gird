import api from './api-client';
import type {
  ServerType,
  ServerStatus,
} from '@gird/core';

// Server API
export const serverApi = {
  list: (params: {
    page?: number;
    pageSize?: number;
    type?: ServerType;
    status?: ServerStatus;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  } = {}) => api.get('/servers', { params }),

  get: (id: string) => api.get(`/servers/${id}`),

  create: (data: {
    name: string;
    type: ServerType;
    config: unknown;
    description?: string;
  }) => api.post('/servers', data),

  update: (id: string, data: {
    name?: string;
    config?: unknown;
    description?: string;
  }) => api.put(`/servers/${id}`, data),

  delete: (id: string) => api.delete(`/servers/${id}`),

  start: (id: string, options?: unknown) =>
    api.post(`/servers/${id}/start`, options || {}),

  stop: (id: string) =>
    api.post(`/servers/${id}/stop`),

  getLogs: (id: string, params?: { tail?: number }) =>
    api.get(`/servers/${id}/logs`, { params }),
};

// API Key API
export const apiKeyApi = {
  list: (params: { page?: number; pageSize?: number; search?: string } = {}) =>
    api.get('/keys', { params }),

  get: (id: string) => api.get(`/keys/${id}`),

  create: (data: { name: string; permissions: { serverIds?: string[] | null } }) =>
    api.post('/keys', data),

  delete: (id: string) => api.delete(`/keys/${id}`),
};

export type { ApiError } from './api-client';
