/**
 * Configuration management for the Gird MCP Server Manager
 */

import type { Config } from './types.js';

const DEFAULT_CONFIG: Config = {
  database: {
    url: 'file:./dev.db',
  },
  agent: {
    port: 3001,
    host: '0.0.0.0',
  },
  api: {
    port: 3000,
    host: '0.0.0.0',
  },
  dashboard: {
    port: 5173,
  },
  apiKeySecret: 'change-this-in-production',
};

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  return {
    database: {
      url: process.env.DATABASE_URL ?? DEFAULT_CONFIG.database.url,
    },
    agent: {
      port: parseInt(process.env.AGENT_PORT ?? String(DEFAULT_CONFIG.agent.port), 10),
      host: process.env.AGENT_HOST ?? DEFAULT_CONFIG.agent.host,
    },
    api: {
      port: parseInt(process.env.API_PORT ?? String(DEFAULT_CONFIG.api.port), 10),
      host: process.env.API_HOST ?? DEFAULT_CONFIG.api.host,
    },
    dashboard: {
      port: parseInt(process.env.DASHBOARD_PORT ?? String(DEFAULT_CONFIG.dashboard.port), 10),
    },
    apiKeySecret: process.env.API_KEY_SECRET ?? DEFAULT_CONFIG.apiKeySecret,
  };
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

  if (config.apiKeySecret === 'change-this-in-production' || config.apiKeySecret.length < 32) {
    errors.push('API_KEY_SECRET must be set to a secure random string (at least 32 characters)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
