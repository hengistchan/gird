/**
 * Docker Compose deployment manager for MCP servers
 */

import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createLogger, DEFAULT_TIMEOUTS } from '@gird/core';
import type { DockerDeploymentConfig } from '@gird/core';
import { DeploymentError } from '@gird/core';

const logger = createLogger('deployment:docker');

// Timeout for Docker commands (60 seconds)
const DOCKER_COMMAND_TIMEOUT = DEFAULT_TIMEOUTS.DOCKER_COMMAND;

export interface ContainerHandle {
  containerId: string;
  serverName: string;
  config: DockerDeploymentConfig;
  composeFile: string;
  startTime: Date;
}

// Track running containers
const runningContainers = new Map<string, ContainerHandle>();

/**
 * Execute a Docker command with proper argument handling (no shell injection)
 * @param args - Docker command arguments
 * @param options.cwd - Working directory
 * @param options.timeout - Command timeout in milliseconds (defaults to DOCKER_COMMAND_TIMEOUT)
 */
async function dockerCommand(
  args: string[],
  options: { cwd?: string; timeout?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const timeout = options.timeout ?? DOCKER_COMMAND_TIMEOUT;

  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Set up timeout to prevent hanging commands
    const timeoutHandle = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Docker command timed out after ${timeout}ms: docker ${args.join(' ')}`));
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      resolve({ stdout, stderr, exitCode: code });
    });

    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`Failed to spawn docker process: ${error.message}`));
    });
  });
}

/**
 * Generate a docker-compose.yml file for a server
 */
function generateComposeFile(
  serverName: string,
  serverId: string,
  config: DockerDeploymentConfig
): string {
  const imageName = config.image ?? `gird-mcp-${serverName.toLowerCase()}`;
  const ports = config.ports ?? {};
  const environment = config.environment ?? {};
  const volumes = config.volumes ?? {};

  // Build port mappings
  const portMappings = Object.entries(ports)
    .map(([containerPort, hostPort]) => `  - "${hostPort}:${containerPort}"`)
    .join('\n');

  // Build environment variables
  const envVars = Object.entries(environment)
    .map(([key, value]) => `  - ${key}=${value}`)
    .join('\n');

  // Build volume mappings
  const volumeMappings = Object.entries(volumes)
    .map(([hostPath, containerPath]) => `  - ${hostPath}:${containerPath}`)
    .join('\n');

  return `
version: '3.8'
services:
  ${serverName}:
    image: ${imageName}
    container_name: gird-${serverId}
    ${portMappings ? `ports:\n${portMappings}` : ''}
    ${envVars ? `environment:\n${envVars}` : ''}
    ${volumeMappings ? `volumes:\n${volumeMappings}` : ''}
    restart: unless-stopped
`;
}

/**
 * Start a Docker container for an MCP server
 */
export async function startDockerServer(
  serverId: string,
  serverName: string,
  config: DockerDeploymentConfig,
  port?: number
): Promise<{ containerId: string; port: number }> {
  logger.info(`Starting Docker container for server: ${serverName}`);

  // Check if already running
  if (runningContainers.has(serverId)) {
    const existing = runningContainers.get(serverId)!;
    // Check if container still exists
    try {
      const result = await dockerCommand([
        'inspect',
        '--format',
        '{{.State.Status}}',
        existing.containerId,
      ]);
      if (result.stdout.trim() === 'running') {
        throw new DeploymentError(
          `Server ${serverName} is already running (Container: ${existing.containerId})`
        );
      }
    } catch {
      // Container doesn't exist or is not running, clean up
      runningContainers.delete(serverId);
    }
  }

  // Create temporary compose file
  const tempDir = '/tmp/gird';
  const composeFile = join(tempDir, `docker-compose-${serverId}.yml`);

  // Add port to config if specified
  if (port && !config.ports) {
    config.ports = { '3000': String(port) };
  }

  const composeContent = generateComposeFile(serverName, serverId, config);
  writeFileSync(composeFile, composeContent, 'utf-8');

  logger.debug(`Generated compose file: ${composeFile}`);

  try {
    // Start the container using docker compose (with proper argument handling)
    const result = await dockerCommand(
      ['compose', '-f', composeFile, 'up', '-d'],
      { cwd: tempDir }
    );

    if (result.stderr) {
      logger.warn(`Docker compose stderr: ${result.stderr}`);
    }

    logger.debug(`Docker compose stdout: ${result.stdout}`);

    if (result.exitCode !== 0) {
      throw new DeploymentError(
        `docker compose up failed (code ${result.exitCode}): ${result.stderr}`
      );
    }

    // Get the container ID
    const containerName = `gird-${serverId}`;
    const containerResult = await dockerCommand(['ps', '-q', '-f', `name=${containerName}`]);

    const containerId = containerResult.stdout.trim();

    if (!containerId) {
      throw new DeploymentError(`Failed to get container ID for ${containerName}`);
    }

    // Get the mapped port
    let mappedPort = port;
    if (!mappedPort) {
      const portResult = await dockerCommand(['port', containerId, '3000']);
      // Parse port output (format: "0.0.0.0:32768" or ":::32768")
      const portOutput = portResult.stdout;
      const match = portOutput.match(/:(\d+)$/);
      mappedPort = match?.[1] ? parseInt(match[1], 10) : 3000;
    }

    // Store the container handle
    const handle: ContainerHandle = {
      containerId,
      serverName,
      config,
      composeFile,
      startTime: new Date(),
    };

    runningContainers.set(serverId, handle);

    logger.info(
      `Started Docker container for server: ${serverName} (Container: ${containerId}, Port: ${mappedPort})`
    );

    return { containerId, port: mappedPort };
  } catch (error) {
    // Clean up compose file on error
    if (existsSync(composeFile)) {
      unlinkSync(composeFile);
    }
    throw new DeploymentError(`Failed to start Docker container: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Stop a Docker container
 */
export async function stopDockerServer(serverId: string, serverName: string): Promise<void> {
  logger.info(`Stopping Docker container for server: ${serverName}`);

  const handle = runningContainers.get(serverId);
  if (!handle) {
    logger.warn(`No running container found for server: ${serverName}`);
    return;
  }

  try {
    // Stop and remove using docker compose (with proper argument handling)
    await dockerCommand(['compose', '-f', handle.composeFile, 'down']);

    logger.info(`Stopped Docker container for server: ${serverName}`);
  } catch (error) {
    logger.error('Failed to stop container gracefully', error instanceof Error ? error : undefined);
    // Try to kill the container directly
    try {
      await dockerCommand(['stop', handle.containerId]);
      await dockerCommand(['rm', handle.containerId]);
    } catch {
      // Ignore errors during force stop
    }
  } finally {
    // Clean up compose file
    if (existsSync(handle.composeFile)) {
      try {
        unlinkSync(handle.composeFile);
      } catch {
        // Ignore errors
      }
    }

    runningContainers.delete(serverId);
  }
}

/**
 * Get container status
 */
export async function getContainerStatus(
  serverId: string
): Promise<{ running: boolean; containerId?: string }> {
  const handle = runningContainers.get(serverId);
  if (!handle) {
    return { running: false };
  }

  try {
    const result = await dockerCommand([
      'inspect',
      '--format',
      '{{.State.Status}}',
      handle.containerId,
    ]);
    const status = result.stdout.trim();

    if (status !== 'running') {
      runningContainers.delete(serverId);
      return { running: false };
    }

    return {
      running: true,
      containerId: handle.containerId,
    };
  } catch {
    runningContainers.delete(serverId);
    return { running: false };
  }
}

/**
 * Get container logs
 */
export async function getContainerLogs(serverId: string, tail: number = 100): Promise<string> {
  const handle = runningContainers.get(serverId);
  if (!handle) {
    return 'No running container found';
  }

  try {
    const result = await dockerCommand(['logs', '--tail', String(tail), handle.containerId]);
    return result.stdout;
  } catch (error) {
    return `Failed to get logs: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Get all running containers
 */
export function getAllContainers(): Array<{
  serverId: string;
  containerId: string;
  serverName: string;
}> {
  return Array.from(runningContainers.entries()).map(([serverId, handle]) => ({
    serverId,
    containerId: handle.containerId,
    serverName: handle.serverName,
  }));
}
