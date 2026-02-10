/**
 * Configuration management for the Gird MCP Server Manager
 */

import type { Config } from './types.js';
import { getEnv, isDev } from './env.js';

/**
 * Load configuration from environment variables
 * Automatically validates the config on load
 * @throws {Error} If configuration is invalid (especially in production)
 */
export function loadConfig(): Config {
  const env = getEnv();

  const config: Config = {
    database: {
      url: env.DATABASE_URL,
    },
    agent: {
      port: env.AGENT_PORT,
      host: env.AGENT_HOST,
    },
    api: {
      port: env.API_PORT,
      host: env.API_HOST,
    },
    dashboard: {
      port: env.DASHBOARD_PORT,
    },
    apiKeySecret: env.API_KEY_SECRET,
  };

  validateConfig(config);

  return config;
}

/**
 * Get a singleton config instance
 */
let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Reset cached config (useful for testing)
 */
export function resetConfig(): void {
  cachedConfig = null;
}

/**
 * Validate configuration
 * In production mode, throws an error if configuration is invalid
 * In development mode, returns validation result without throwing
 */
export function validateConfig(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!config.database.url) {
    errors.push('DATABASE_URL is required');
  }

  if (config.agent.port < 1 || config.agent.port > 65535) {
    errors.push('AGENT_PORT must be between 1 and 65535');
  }

  if (config.api.port < 1 || config.api.port > 65535) {
    errors.push('API_PORT must be between 1 and 65535');
  }

  if (config.dashboard.port < 1 || config.dashboard.port > 65535) {
    errors.push('DASHBOARD_PORT must be between 1 and 65535');
  }

  // In production, API_KEY_SECRET must be properly set
  if (!isDev()) {
    if (config.apiKeySecret === 'change-this-in-production' ||
        config.apiKeySecret.length < 32) {
      errors.push('API_KEY_SECRET must be set to a secure random string (at least 32 characters) in production');
    }
  } else {
    // In development, warn but don't fail
    if (config.apiKeySecret === 'change-this-in-production' || config.apiKeySecret.length < 32) {
      console.warn('Warning: API_KEY_SECRET should be set to a secure random string (at least 32 characters)');
    }
  }

  const result = {
    valid: errors.length === 0,
    errors,
  };

  // Throw in production if invalid
  if (!result.valid && !isDev()) {
    throw new Error(
      `Invalid configuration:\n${errors.map(e => `  - ${e}`).join('\n')}`
    );
  }

  return result;
}
