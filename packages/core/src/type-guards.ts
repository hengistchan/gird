/**
 * Type guards for runtime type validation
 */

import type {
  ServerConfig,
  StdioServerConfig,
  SseServerConfig,
  AwsLambdaServerConfig,
  ExecutableServerConfig,
  ApiKeyPermissions,
} from './types.js';

/**
 * Check if a value is a valid StdioServerConfig
 */
export function isStdioServerConfig(config: unknown): config is StdioServerConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'command' in config &&
    typeof (config as { command: unknown }).command === 'string'
  );
}

/**
 * Check if a value is a valid SseServerConfig
 */
export function isSseServerConfig(config: unknown): config is SseServerConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'url' in config &&
    typeof (config as { url: unknown }).url === 'string'
  );
}

/**
 * Check if a value is a valid AwsLambdaServerConfig
 */
export function isAwsLambdaServerConfig(config: unknown): config is AwsLambdaServerConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'functionName' in config &&
    typeof (config as { functionName: unknown }).functionName === 'string'
  );
}

/**
 * Check if a value is a valid ExecutableServerConfig
 */
export function isExecutableServerConfig(config: unknown): config is ExecutableServerConfig {
  return (
    typeof config === 'object' &&
    config !== null &&
    'path' in config &&
    typeof (config as { path: unknown }).path === 'string'
  );
}

/**
 * Narrow unknown to ServerConfig with validation
 * @throws Error if config doesn't match any ServerConfig type
 */
export function asServerConfig(config: unknown): ServerConfig {
  if (isStdioServerConfig(config)) {
    return config;
  }
  if (isSseServerConfig(config)) {
    return config;
  }
  if (isAwsLambdaServerConfig(config)) {
    return config;
  }
  if (isExecutableServerConfig(config)) {
    return config;
  }
  throw new Error('Invalid server config: must match one of STDIO, SSE, AWS_LAMBDA, or EXECUTABLE config schemas');
}

/**
 * Check if a value is a valid Prisma InputJsonValue (non-null JSON value)
 */
export function isInputJsonValue(value: unknown): value is string | number | boolean | { [key: string]: unknown } | unknown[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return true;
  }
  return typeof value === 'object' && value !== null;
}

/**
 * Convert unknown to Prisma-compatible InputJsonValue (cannot be null)
 * @throws Error if value is not JSON-serializable or is null
 */
export function asPrismaInputJsonValue(value: unknown):
  | string
  | number
  | boolean
  | { [key: string]: unknown }
  | unknown[] {
  if (!isInputJsonValue(value)) {
    throw new Error(`Value is not a valid JSON input (cannot be null): ${String(value)}`);
  }
  return value;
}

/**
 * Check if a value is a valid Prisma JsonValue (for use with Prisma fields)
 */
export function isJsonValue(value: unknown): value is string | number | boolean | null | { [key: string]: unknown } | unknown[] {
  return value === null || isInputJsonValue(value);
}

/**
 * Convert unknown to Prisma-compatibleJsonValue (includes null)
 * @throws Error if value is not JSON-serializable
 */
export function asPrismaJsonValue(value: unknown):
  | string
  | number
  | boolean
  | null
  | { [key: string]: unknown }
  | unknown[] {
  if (!isJsonValue(value)) {
    throw new Error(`Value is not JSON-serializable: ${String(value)}`);
  }
  return value;
}

/**
 * Check if a value is a valid ApiKeyPermissions
 */
export function isApiKeyPermissions(value: unknown): value is ApiKeyPermissions {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const permissions = value as Record<string, unknown>;
  const serverIds = permissions.serverIds;
  // serverIds can be null (all servers), an array of strings, or undefined
  return (
    serverIds === null ||
    serverIds === undefined ||
    (Array.isArray(serverIds) && serverIds.every((id) => typeof id === 'string'))
  );
}

/**
 * Narrow unknown to ApiKeyPermissions
 * @throws Error if value doesn't match ApiKeyPermissions shape
 */
export function asApiKeyPermissions(value: unknown): ApiKeyPermissions {
  if (isApiKeyPermissions(value)) {
    return value;
  }
  throw new Error('Invalid API key permissions: must be an object with optional serverIds array or null');
}

/**
 * Type guard for record of strings (environment variables, headers, etc.)
 */
export function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value as Record<string, unknown>).every(
    ([, v]) => typeof v === 'string'
  );
}

/**
 * Narrow unknown to Record<string, string>
 */
export function asStringRecord(value: unknown): Record<string, string> {
  if (isStringRecord(value)) {
    return value;
  }
  throw new Error('Invalid value: expected Record<string, string>');
}
