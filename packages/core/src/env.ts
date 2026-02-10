/**
 * Environment variable validation with Zod
 */

import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1).default('file:./dev.db'),
  API_KEY_SECRET: z.string().min(32, 'API_KEY_SECRET must be at least 32 characters'),
  AGENT_HOST: z.string().default('127.0.0.1'),
  AGENT_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DASHBOARD_PORT: z.coerce.number().int().min(1).max(65535).default(5173),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;
let isDevelopment: boolean | null = null;

/**
 * Load and validate environment variables
 * @throws {z.ZodError} If environment variables are invalid
 */
export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;

  try {
    cachedEnv = EnvSchema.parse(process.env);
    isDevelopment = cachedEnv.NODE_ENV === 'development';
    return cachedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Invalid environment configuration:');
      error.errors.forEach((err) => {
        console.error(`  ${err.path.join('.')}: ${err.message}`);
      });
    }
    throw error;
  }
}

/**
 * Get the cached env or load if not cached
 */
export function getEnv(): Env {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

/**
 * Check if running in development mode
 */
export function isDev(): boolean {
  if (isDevelopment === null) {
    loadEnv();
  }
  return isDevelopment === true;
}

/**
 * Check if running in production mode
 */
export function isProd(): boolean {
  return !isDev();
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return getEnv().NODE_ENV === 'test';
}

/**
 * Reset cached env (useful for testing)
 */
export function resetEnv(): void {
  cachedEnv = null;
  isDevelopment = null;
}
