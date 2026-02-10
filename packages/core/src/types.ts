/**
 * Shared type definitions for the Gird MCP Server Manager
 */

// ============================================================================
// Server Types
// ============================================================================

export type ServerType = 'STDIO' | 'SSE' | 'AWS_LAMBDA' | 'EXECUTABLE';

export type ServerStatus = 'ACTIVE' | 'STOPPED' | 'ERROR';

export type DeploymentType = 'DOCKER_COMPOSE' | 'LOCAL_PROCESS';

export type DeploymentStatus = 'RUNNING' | 'STOPPED' | 'ERROR';

// ============================================================================
// Server Configuration Types
// ============================================================================

export interface BaseServerConfig {
  description?: string;
}

export interface StdioServerConfig extends BaseServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface SseServerConfig extends BaseServerConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface AwsLambdaServerConfig extends BaseServerConfig {
  functionName: string;
  region?: string;
  credentials?: {
    accessKeyId?: string;
    secretAccessKey?: string;
  };
}

export interface ExecutableServerConfig extends BaseServerConfig {
  path: string;
  args?: string[];
  env?: Record<string, string>;
}

export type ServerConfig =
  | StdioServerConfig
  | SseServerConfig
  | AwsLambdaServerConfig
  | ExecutableServerConfig;

// ============================================================================
// Deployment Configuration Types
// ============================================================================

export interface DockerDeploymentConfig {
  composeFile?: string;
  image?: string;
  ports?: Record<string, string>;
  environment?: Record<string, string>;
  volumes?: Record<string, string>;
}

export interface LocalProcessDeploymentConfig {
  autoRestart?: boolean;
  logFile?: string;
}

export type DeploymentConfig =
  | DockerDeploymentConfig
  | LocalProcessDeploymentConfig;

// ============================================================================
// API Key Types
// ============================================================================

export interface ApiKeyPermissions {
  serverIds?: string[] | null; // null = all servers
}

export interface ApiKeyInfo {
  id: string;
  name: string;
  permissions: ApiKeyPermissions;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Server & Deployment Types (from Prisma)
// ============================================================================

export interface Server {
  id: string;
  name: string;
  type: ServerType;
  config: ServerConfig;
  status: ServerStatus;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  deployments: Deployment[];
}

export interface Deployment {
  id: string;
  serverId: string;
  type: DeploymentType;
  status: DeploymentStatus;
  port: number | null;
  host: string | null;
  containerId: string | null;
  pid: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApiKey {
  id: string;
  key: string;
  keyHash: string;
  name: string;
  permissions: ApiKeyPermissions;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface CreateServerRequest {
  name: string;
  type: ServerType;
  config: ServerConfig;
  description?: string;
}

export interface UpdateServerRequest {
  name?: string;
  config?: ServerConfig;
  description?: string;
}

export interface CreateApiKeyRequest {
  name: string;
  permissions: ApiKeyPermissions;
}

export interface ServerResponse {
  id: string;
  name: string;
  type: ServerType;
  status: ServerStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentResponse {
  id: string;
  serverId: string;
  type: DeploymentType;
  status: DeploymentStatus;
  port: number | null;
  host: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyResponse {
  id: string;
  name: string;
  permissions: ApiKeyPermissions;
  key: string; // Only shown on creation
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyListResponse {
  id: string;
  name: string;
  permissions: ApiKeyPermissions;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// MCP Protocol Types (for proxy)
// ============================================================================

export interface McpRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface Config {
  database: {
    url: string;
  };
  agent: {
    port: number;
    host: string;
  };
  api: {
    port: number;
    host: string;
  };
  dashboard: {
    port: number;
  };
  apiKeySecret: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class GirdError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: unknown
  ) {
    super(message);
    this.name = 'GirdError';
  }
}

export class AuthenticationError extends GirdError {
  constructor(message: string = 'Authentication failed', details?: unknown) {
    super(message, 'AUTHENTICATION_ERROR', 401, details);
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends GirdError {
  constructor(message: string = 'Authorization failed', details?: unknown) {
    super(message, 'AUTHORIZATION_ERROR', 403, details);
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends GirdError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, { resource, id });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends GirdError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class DeploymentError extends GirdError {
  constructor(message: string, details?: unknown) {
    super(message, 'DEPLOYMENT_ERROR', 500, details);
    this.name = 'DeploymentError';
  }
}

export class ProxyError extends GirdError {
  constructor(message: string, details?: unknown) {
    super(message, 'PROXY_ERROR', 502, details);
    this.name = 'ProxyError';
  }
}

export class FileNotFoundError extends GirdError {
  constructor(path: string) {
    super(`File not found: ${path}`, 'FILE_NOT_FOUND', 404, { path });
    this.name = 'FileNotFoundError';
  }
}

// ============================================================================
// Monitoring & Health Check Types
// ============================================================================

export type HealthStatus = 'healthy' | 'unhealthy' | 'degraded';

export interface HealthCheckConfig {
  endpoint?: string;           // Custom health endpoint
  interval: number;            // Check interval in seconds
  timeout: number;             // Request timeout in milliseconds
  retries: number;             // Consecutive failures before unhealthy
  expectedStatus?: number;     // Expected HTTP status
  expectedBody?: string | RegExp;  // Expected response body
}

export interface HealthCheckResult {
  status: HealthStatus;
  responseTime: number;        // milliseconds
  message?: string;
  checkedAt: Date;
}

export interface MetricLabel {
  [key: string]: string | number | boolean;
}

export interface MetricData {
  id: string;
  tenantId: string | null;
  name: string;                // e.g., "mcp_requests_total", "deployment_uptime"
  value: number;
  labels: MetricLabel;
  timestamp: Date;
}

// ============================================================================
// Security & Authentication Types
// ============================================================================

export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  avatar?: string;
  emailVerified: boolean;
  status: UserStatus;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  refreshToken?: string;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
}

export interface JwtPayload {
  apiKeyId: string;
  tenantId?: string;
  permissions: ApiKeyPermissions;
  iat?: number;
  exp: number;
}

export interface UserJwtPayload {
  userId: string;
  email: string;
  tenantId?: string;
  roles: string[];
  permissions?: Record<string, boolean>;
  iat?: number;
  exp: number;
}

export interface ApiKeyInfoExtended {
  id: string;
  name: string;
  permissions: ApiKeyPermissions;
  createdAt: Date;
  updatedAt: Date;
  tenantId?: string;
  ipWhitelist: string[];       // Array of allowed IP addresses/CIDR ranges
  expiresAt: Date | null;
  lastUsedAt: Date | null;
}

export interface RateLimitConfig {
  maxRequests: number;         // Maximum requests per window
  windowMs: number;            // Time window in milliseconds
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  reset: Date;                 // When the limit resets
}

export interface AuditLogEntry {
  id: string;
  action: string;              // "server.create", "key.delete", "api.request", etc.
  entityType: string;          // "server", "key", "deployment", "request"
  entityId: string;
  userId?: string;
  apiKeyId?: string;
  tenantId?: string;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorCode?: string;
  details?: unknown;
  createdAt: Date;
}

// ============================================================================
// RBAC (Role-Based Access Control) Types
// ============================================================================

export interface RolePermission {
  servers: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
  };
  apiKeys: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
  };
  users: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
    manageRoles?: boolean;
  };
  tenants: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
  };
  webhooks: {
    create?: boolean;
    read?: boolean;
    update?: boolean;
    delete?: boolean;
  };
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  permissions: RolePermission;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserRole {
  id: string;
  userId: string;
  roleId: string;
  createdAt: Date;
}

// ============================================================================
// Multi-Tenancy Types
// ============================================================================

export interface TenantQuota {
  maxServers: number;
  maxKeys: number;
  maxRequestsPerMinute: number;
  maxDeploymentsPerServer?: number;
}

export interface TenantSettings {
  features: {
    healthChecks?: boolean;
    autoRestart?: boolean;
    metrics?: boolean;
    auditLogs?: boolean;
    rateLimiting?: boolean;
    ipWhitelist?: boolean;
  };
  limits?: {
    maxDeploymentTime?: number;     // minutes
    maxLogRetentionDays?: number;
    maxMetricRetentionDays?: number;
  };
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;                    // For subdomain routing
  quota: TenantQuota;
  settings: TenantSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  quota: TenantQuota;
  settings: TenantSettings;
}

export interface UsageStats {
  servers: { used: number; limit: number };
  apiKeys: { used: number; limit: number };
  requests: { used: number; limit: number; window: string };
  deployments?: { used: number; limit: number };
}

export interface UsageTimeseriesPoint {
  timestamp: Date;
  count: number;
  metric: string;
}

// ============================================================================
// Usage & Quota Types
// ============================================================================

export interface UsageRecord {
  id: string;
  tenantId?: string;
  userId?: string;
  apiKeyId?: string;
  metricName: string;
  quantity: number;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Auto-Restart Types
// ============================================================================

export interface RestartPolicy {
  enabled: boolean;
  maxRetries: number;
  backoffMultiplier: number;     // e.g., 2 for exponential backoff
  maxBackoffSeconds: number;
}

export type DeploymentConfigExtended = (
  | DockerDeploymentConfig
  | LocalProcessDeploymentConfig
) & {
  healthCheck?: HealthCheckConfig;
  restartPolicy?: RestartPolicy;
  metrics?: boolean;
}

// ============================================================================
// Real-time Communication Types
// ============================================================================

export interface ServerLogEntry {
  timestamp: Date;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  deploymentId?: string;
  serverId?: string;
}

export interface ServerEvent {
  type: 'deployment_status' | 'health_status' | 'log' | 'metric' | 'error';
  data: unknown;
  timestamp: Date;
  deploymentId?: string;
  serverId?: string;
  tenantId?: string;
}

// ============================================================================
// Webhook Types
// ============================================================================

export type WebhookEventType =
  | 'SERVER_CREATED'
  | 'SERVER_UPDATED'
  | 'SERVER_DELETED'
  | 'SERVER_STARTED'
  | 'SERVER_STOPPED'
  | 'API_KEY_CREATED'
  | 'USER_CREATED'
  | 'USAGE_THRESHOLD_REACHED'
  | 'QUOTA_EXCEEDED';

export interface Webhook {
  id: string;
  tenantId?: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  isActive: boolean;
  lastTriggerAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventType: WebhookEventType;
  payload: unknown;
  statusCode?: number;
  response?: string;
  deliveredAt?: Date;
  createdAt: Date;
}

export interface WebhookPayload {
  eventType: WebhookEventType;
  timestamp: Date;
  tenantId?: string;
  data: unknown;
}

// ============================================================================
// CLI Interactive Types
// ============================================================================

export interface ServerTemplate {
  name: string;
  displayName: string;
  description: string;
  type: ServerType;
  config: ServerConfig;
  features?: {
    healthCheck?: Partial<HealthCheckConfig>;
    autoRestart?: Partial<RestartPolicy>;
  };
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
  data: T;
  success: true;
}

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
  success: false;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
  success: true;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  success: true;
}

// ============================================================================
// Pagination Query Types
// ============================================================================

export interface PaginationQuery {
  page: number;
  pageSize: number;
}

export interface ServerListQuery extends PaginationQuery {
  type?: ServerType;
  status?: ServerStatus;
  search?: string;
  sortBy?: 'name' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface ApiKeyListQuery extends PaginationQuery {
  search?: string;
}
