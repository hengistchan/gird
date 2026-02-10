// Dashboard-specific API types that extend or specialize core types

import type {
  Server,
  ServerType,
  ServerStatus,
  Deployment,
} from '@gird/core';

// ============================================================================
// List Query Parameters Types
// ============================================================================

export interface ServerListParams {
  page?: number;
  pageSize?: number;
  type?: ServerType;
  status?: ServerStatus;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ApiKeyListParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  success: true;
}

export interface ApiErrorResponse {
  message: string;
  code?: string;
  details?: unknown;
  status?: number;
}

// ============================================================================
// Server with Deployment Info
// ============================================================================

export interface ServerWithDeployment extends Server {
  latestDeployment?: Deployment;
}

// ============================================================================
// Form Types
// ============================================================================

export interface ServerFormData {
  name: string;
  type: ServerType;
  config: unknown;
  description?: string;
}

export interface ApiKeyFormData {
  name: string;
  permissions: {
    serverIds?: string[] | null;
  };
}

// ============================================================================
// Log Types
// ============================================================================

export interface ServerLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  context?: Record<string, unknown>;
}

export interface LogsResponse {
  logs: ServerLogEntry[];
  hasMore: boolean;
}

// ============================================================================
// Auth Types
// ============================================================================

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: null; // Can be extended with user info later
}
