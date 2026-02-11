/**
 * CLI Configuration Management
 *
 * Loads configuration from ~/.gird/config.json
 *
 * Configuration format:
 * {
 *   "apiEndpoint": "http://localhost:3000",
 *   "agentEndpoint": "http://localhost:3001",
 *   "outputFormat": "table" | "json" | "plain"
 * }
 */

import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { logger } from '@gird/core';

export interface CliConfig {
  /** API server endpoint */
  apiEndpoint: string;
  /** Agent server endpoint */
  agentEndpoint: string;
  /** Output format for CLI commands */
  outputFormat: 'json' | 'table' | 'plain';
}

const DEFAULT_CONFIG: CliConfig = {
  apiEndpoint: 'http://localhost:3000',
  agentEndpoint: 'http://localhost:3001',
  outputFormat: 'table',
};

const CONFIG_DIR = join(homedir(), '.gird');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

let cachedConfig: CliConfig | null = null;

/**
 * Load CLI configuration from ~/.gird/config.json
 * Falls back to default configuration if file doesn't exist
 */
export function loadConfig(): CliConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  if (!existsSync(CONFIG_PATH)) {
    logger.debug(`Config file not found at ${CONFIG_PATH}, using defaults`);
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }

  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    const userConfig = JSON.parse(content) as Partial<CliConfig>;
    cachedConfig = { ...DEFAULT_CONFIG, ...userConfig };
    logger.debug(`Loaded config from ${CONFIG_PATH}`);
    return cachedConfig;
  } catch {
    logger.warn(`Failed to load config from ${CONFIG_PATH}, using defaults`);
    cachedConfig = { ...DEFAULT_CONFIG };
    return cachedConfig;
  }
}

/**
 * Get a specific configuration value
 */
export function getConfigValue<K extends keyof CliConfig>(key: K): CliConfig[K] {
  const config = loadConfig();
  return config[key];
}

/**
 * Set a configuration value and persist to file
 */
export function setConfigValue<K extends keyof CliConfig>(
  key: K,
  value: CliConfig[K]
): void {
  const config = loadConfig();
  config[key] = value;
  saveConfig(config);
  cachedConfig = null; // Invalidate cache
}

/**
 * Save configuration to file
 */
export function saveConfig(config: CliConfig): void {
  try {
    // Ensure config directory exists
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    logger.info(`Config saved to ${CONFIG_PATH}`);
  } catch (err) {
    logger.error(`Failed to save config to ${CONFIG_PATH}`);
    throw err;
  }
}

/**
 * Reset configuration to defaults
 */
export function resetConfig(): void {
  cachedConfig = null;
  saveConfig(DEFAULT_CONFIG);
}

/**
 * Get the configuration file path
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Check if config file exists
 */
export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}
