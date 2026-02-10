/**
 * Local Process deployment manager for MCP servers
 */

import { spawn, ChildProcess } from 'node:child_process';
import { createLogger, getPrisma } from '@gird/core';
import type { StdioServerConfig, ExecutableServerConfig } from '@gird/core';
import { DeploymentError } from '@gird/core';

const logger = createLogger('deployment:local');

// Maximum log lines to buffer
const MAX_LOG_LINES = 1000;

/**
 * Process state enumeration
 */
export enum ProcessState {
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Error = 'error',
}

export interface ProcessHandle {
  pid: number;
  process: ChildProcess;
  config: StdioServerConfig | ExecutableServerConfig;
  serverName: string;
  startTime: Date;
  logBuffer: string[];
  state: ProcessState;
}

// Track running processes
const runningProcesses = new Map<string, ProcessHandle>();

/**
 * Start a local process for an MCP server
 */
export async function startLocalProcess(
  serverId: string,
  serverName: string,
  config: StdioServerConfig | ExecutableServerConfig
): Promise<{ pid: number; port?: number }> {
  logger.info(`Starting local process for server: ${serverName}`);

  // Check if already running
  if (runningProcesses.has(serverId)) {
    const existing = runningProcesses.get(serverId)!;
    if (existing.process && !existing.process.killed) {
      throw new DeploymentError(`Server ${serverName} is already running (PID: ${existing.pid})`);
    }
  }

  // Determine command and args based on config type
  let command: string;
  let args: string[] = [];
  let env: Record<string, string> = {};
  let cwd: string | undefined;

  if ('command' in config) {
    // StdioServerConfig
    command = config.command;
    args = config.args ?? [];
    env = config.env ?? {};
    cwd = config.cwd;
  } else {
    // ExecutableServerConfig
    command = config.path;
    args = config.args ?? [];
    env = config.env ?? {};
  }

  // Merge with current environment
  const mergedEnv = { ...process.env, ...env };

  logger.debug(`Spawning process`, { command, args, env: mergedEnv, cwd });

  // Spawn the process
  const childProcess = spawn(command, args, {
    env: mergedEnv,
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: false,
  });

  // Store the process handle
  const handle: ProcessHandle = {
    pid: childProcess.pid ?? 0,
    process: childProcess,
    config,
    serverName,
    startTime: new Date(),
    logBuffer: [],
    state: ProcessState.Starting,
  };

  // Setup log buffering
  const addLog = (line: string) => {
    handle.logBuffer.push(line);
    // Keep buffer size under limit
    if (handle.logBuffer.length > MAX_LOG_LINES) {
      handle.logBuffer.shift();
    }
  };

  // Capture stdout to buffer
  childProcess.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line) {
        logger.debug(`[${serverName}] stdout: ${line}`);
        addLog(`[stdout] ${line}`);
      }
    }
  });

  // Capture stderr to buffer
  childProcess.stderr?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (line) {
        logger.warn(`[${serverName}] stderr: ${line}`);
        addLog(`[stderr] ${line}`);
      }
    }
  });

  // Add startup message
  addLog(`[system] Process started with PID: ${childProcess.pid}`);

  // Handle process exit
  childProcess.on('exit', (code, signal) => {
    logger.info(`[${serverName}] Process exited`, { code, signal });
    addLog(`[system] Process exited with code ${code}, signal ${signal}`);

    // Update state
    handle.state = ProcessState.Stopped;

    // Clear the log buffer to prevent memory leak
    handle.logBuffer = [];

    runningProcesses.delete(serverId);
  });

  childProcess.on('error', (error) => {
    logger.error(`[${serverName}] Process error`, error);
    addLog(`[system] Process error: ${error.message}`);

    // Update state
    handle.state = ProcessState.Error;

    // Clear the log buffer to prevent memory leak
    handle.logBuffer = [];

    runningProcesses.delete(serverId);
  });

  // Store the process handle
  runningProcesses.set(serverId, handle);

  // Update state to running after successful setup
  handle.state = ProcessState.Running;

  logger.info(`Started local process for server: ${serverName} (PID: ${childProcess.pid})`);

  return { pid: childProcess.pid ?? 0 };
}

/**
 * Stop a local process
 */
export async function stopLocalProcess(serverId: string, serverName: string): Promise<void> {
  logger.info(`Stopping local process for server: ${serverName}`);

  const handle = runningProcesses.get(serverId);
  if (!handle) {
    logger.warn(`No running process found for server: ${serverName}`);
    return;
  }

  // Check if already stopping or stopped
  if (handle.state === ProcessState.Stopping || handle.state === ProcessState.Stopped) {
    logger.info(`Process already stopping or stopped: ${serverName}`);
    return;
  }

  // Update state to stopping
  handle.state = ProcessState.Stopping;

  return new Promise((resolve) => {
    let cleaned = false; // Flag to prevent double cleanup

    const cleanup = (reason: string) => {
      if (cleaned) {
        return;
      }
      cleaned = true;

      logger.info(`[${serverName}] Cleanup complete (${reason})`);

      // Clear the log buffer to prevent memory leak
      handle.logBuffer = [];

      // Remove all listeners to prevent further callbacks
      handle.process.removeAllListeners();

      // Remove from running processes
      runningProcesses.delete(serverId);

      // Update state
      handle.state = ProcessState.Stopped;

      resolve();
    };

    const timeout = setTimeout(() => {
      // Force kill if graceful shutdown fails
      logger.warn(`Force killing process for server: ${serverName} (timeout)`);
      handle.process.kill('SIGKILL');
      cleanup('timeout');
    }, 5000);

    handle.process.once('exit', (code, signal) => {
      clearTimeout(timeout);
      logger.info(`[${serverName}] Process stopped (code: ${code}, signal: ${signal})`);
      cleanup('exit');
    });

    // Try graceful shutdown first
    handle.process.kill('SIGTERM');
  });
}

/**
 * Get process status
 */
export function getProcessStatus(serverId: string): { running: boolean; pid?: number; uptime?: number } {
  const handle = runningProcesses.get(serverId);
  if (!handle) {
    return { running: false };
  }

  if (handle.process.killed) {
    // Clear the log buffer to prevent memory leak
    handle.logBuffer = [];
    runningProcesses.delete(serverId);
    return { running: false };
  }

  return {
    running: true,
    pid: handle.pid,
    uptime: Date.now() - handle.startTime.getTime(),
  };
}

/**
 * Get process logs (recent output)
 */
export function getProcessLogs(serverId: string, tail: number = 100): string[] {
  const handle = runningProcesses.get(serverId);
  if (!handle) {
    return [];
  }

  // Get the requested number of lines, defaulting to 100
  const requestedTail = Math.max(0, Math.min(tail, MAX_LOG_LINES));
  const startIndex = Math.max(0, handle.logBuffer.length - requestedTail);

  return handle.logBuffer.slice(startIndex);
}

/**
 * Get all running processes
 */
export function getAllProcesses(): Array<{ serverId: string; pid: number; serverName: string }> {
  return Array.from(runningProcesses.entries()).map(([serverId, handle]) => ({
    serverId,
    pid: handle.pid,
    serverName: handle.serverName,
  }));
}

/**
 * Reconcile deployments on startup - checks running deployments and updates
 * their status if the process is no longer running. This prevents stale state
 * after a server restart.
 */
export async function reconcileOnStartup(): Promise<void> {
  logger.info('Reconciling deployments on startup...');

  try {
    const prisma = getPrisma();

    // Get all deployments marked as RUNNING
    const runningDeployments = await prisma.deployment.findMany({
      where: {
        status: 'RUNNING',
        type: 'LOCAL_PROCESS',
      },
      include: {
        server: true,
      },
    });

    for (const deployment of runningDeployments) {
      // Check if there's a tracked process for this deployment
      const handle = runningProcesses.get(deployment.serverId);

      if (!handle) {
        // No tracked process - the server was restarted
        // Update deployment status to STOPPED
        logger.info(`Updating stale deployment ${deployment.id} to STOPPED`);
        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'STOPPED' },
        });
      } else if (handle.process.killed || !handle.process.pid) {
        // Process is dead - clean up
        logger.info(`Cleaning up dead process for deployment ${deployment.id}`);
        handle.logBuffer = [];
        runningProcesses.delete(deployment.serverId);

        await prisma.deployment.update({
          where: { id: deployment.id },
          data: { status: 'STOPPED' },
        });
      }
    }

    logger.info(`Reconciled ${runningDeployments.length} deployments`);
  } catch (error) {
    logger.error('Error reconciling deployments on startup', error as Error);
  }
}

/**
 * Clean up resources - clear all log buffers and process handles
 * Call this on graceful shutdown
 */
export function cleanupResources(): void {
  logger.info('Cleaning up deployment resources...');

  for (const [, handle] of runningProcesses.entries()) {
    // Clear log buffers to prevent memory leaks
    handle.logBuffer = [];
  }

  // Clear all tracked processes
  runningProcesses.clear();

  logger.info('Deployment resources cleaned up');
}
