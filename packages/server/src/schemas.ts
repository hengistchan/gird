/**
 * Request/Response validation schemas
 */

import { z } from 'zod';

// ============================================================================
// Server Schemas
// ============================================================================

export const ServerTypeSchema = z.enum(['STDIO', 'SSE', 'AWS_LAMBDA', 'EXECUTABLE']);

export const StdioServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
});

export const SseServerConfigSchema = z.object({
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
});

export const AwsLambdaServerConfigSchema = z.object({
  functionName: z.string(),
  region: z.string().optional(),
  credentials: z.object({
    accessKeyId: z.string().optional(),
    secretAccessKey: z.string().optional(),
  }).optional(),
});

export const ExecutableServerConfigSchema = z.object({
  path: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export const ServerConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('STDIO'),
    config: StdioServerConfigSchema,
  }),
  z.object({
    type: z.literal('SSE'),
    config: SseServerConfigSchema,
  }),
  z.object({
    type: z.literal('AWS_LAMBDA'),
    config: AwsLambdaServerConfigSchema,
  }),
  z.object({
    type: z.literal('EXECUTABLE'),
    config: ExecutableServerConfigSchema,
  }),
]);

export const CreateServerSchema = z.object({
  name: z.string().min(1).max(100),
  type: ServerTypeSchema,
  config: z
    .union([
      StdioServerConfigSchema,
      SseServerConfigSchema,
      AwsLambdaServerConfigSchema,
      ExecutableServerConfigSchema,
    ])
    .optional(),
  description: z.string().optional(),
});

export const UpdateServerSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z
    .union([
      StdioServerConfigSchema,
      SseServerConfigSchema,
      AwsLambdaServerConfigSchema,
      ExecutableServerConfigSchema,
    ])
    .optional(),
  description: z.string().optional(),
});

// ============================================================================
// Deployment Schemas
// ============================================================================

export const DeploymentTypeSchema = z.enum(['DOCKER_COMPOSE', 'LOCAL_PROCESS']);

// Docker deployment configuration schema
const DockerDeploymentConfigSchema = z.object({
  image: z.string().optional(),
  ports: z.record(z.string()).optional(),
  environment: z.record(z.string()).optional(),
  volumes: z.record(z.string()).optional(),
  port: z.number().optional(),
});

// Local process deployment configuration schema
const LocalProcessDeploymentConfigSchema = z.object({
  autoRestart: z.boolean().optional(),
  logFile: z.string().optional(),
  port: z.number().optional(),
});

export const CreateDeploymentSchema = z.object({
  type: DeploymentTypeSchema,
  config: z.union([DockerDeploymentConfigSchema, LocalProcessDeploymentConfigSchema]).optional(),
});

// ============================================================================
// API Key Schemas
// ============================================================================

export const ApiKeyPermissionsSchema = z.object({
  serverIds: z.array(z.string()).nullable().optional(),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  permissions: ApiKeyPermissionsSchema,
});

// ============================================================================
// Common Schemas
// ============================================================================

export const IdParamsSchema = z.object({
  id: z.string(),
});

export const ServerIdParamsSchema = z.object({
  serverId: z.string(),
});
