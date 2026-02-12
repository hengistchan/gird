/**
 * STDIO Process Pool for managing MCP server processes
 * Handles spawning, lifecycle management, and request/response routing
 */

import { spawn, ChildProcess } from 'node:child_process';
import { createLogger, ProxyError, type StdioServerConfig, type McpRequest, type McpResponse } from '@gird-mcp/core';
import { ResponseBuffer } from './response-buffer.js';

const logger = createLogger('stdio:pool');

/** Default timeout for requests (30 seconds) */
const DEFAULT_REQUEST_TIMEOUT = 30000;

/** Maximum time to wait for graceful shutdown (5 seconds) */
const SHUTDOWN_TIMEOUT = 5000;

/** Maximum retries for failed requests */
const MAX_RETRIES = 3;

/** Delay before retrying after process crash (ms) */
const RETRY_DELAY = 1000;

/** MCP protocol version */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/**
 * MCP notification (request without id)
 */
interface McpNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

/**
 * Custom error for retryable failures
 */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

/**
 * Internal representation of a managed STDIO process
 */
interface StdioProcess {
  serverId: string;
  process: ChildProcess;
  config: StdioServerConfig;
  responseBuffer: ResponseBuffer;
  initialized: boolean;
  initializing: boolean;
  lastUsed: Date;
  requestQueue: Array<{
    request: McpRequest;
    resolve: (response: McpResponse) => void;
    reject: (error: Error) => void;
    retryCount: number;
  }>;
  processing: boolean;
  crashCount: number;
  lastCrashTime?: Date;
  spawnPromise?: Promise<StdioProcess | null>;
}

/**
 * STDIO Process Pool - manages MCP server processes with stdin/stdout communication
 */
class StdioProcessPool {
  private processes = new Map<string, StdioProcess>();

  /**
   * Get or create a STDIO process for the given server
   * @param serverId - Unique server identifier
   * @param config - STDIO server configuration
   * @returns The STDIO process handle
   */
  async get(serverId: string, config: StdioServerConfig): Promise<StdioProcess> {
    const existing = this.processes.get(serverId);

    // Check if existing process is still alive
    if (existing && !existing.process.killed && existing.process.exitCode === null) {
      existing.lastUsed = new Date();
      return existing;
    }

    // Clean up dead process if it exists
    if (existing) {
      this.cleanupProcess(serverId, 'Process died');
    }

    // Spawn new process
    return this.spawn(serverId, config);
  }

  /**
   * Spawn a new STDIO process
   */
  private async spawn(serverId: string, config: StdioServerConfig): Promise<StdioProcess> {
    logger.info(`Spawning STDIO process for server: ${serverId}`);

    const args = config.args ?? [];
    const env = { ...process.env, ...config.env };

    // Create a promise that resolves when spawn succeeds or fails
    const child = await new Promise<ChildProcess>((resolve, reject) => {
      const proc = spawn(config.command, args, {
        env,
        cwd: config.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
      });

      let resolved = false;

      // Handle spawn event (Node.js 16+)
      proc.once('spawn', () => {
        if (!resolved) {
          resolved = true;
          resolve(proc);
        }
      });

      // Handle error event
      proc.once('error', (error: NodeJS.ErrnoException) => {
        if (!resolved) {
          resolved = true;
          reject(new ProxyError(`Failed to spawn process for server ${serverId}: ${error.message}`));
        }
      });

      // Fallback: if pid is set immediately, resolve
      if (proc.pid) {
        resolved = true;
        resolve(proc);
        return;
      }

      // Timeout fallback for older Node.js versions
      setTimeout(() => {
        if (!resolved) {
          if (proc.pid) {
            resolve(proc);
          } else {
            reject(new ProxyError(`Failed to spawn process for server ${serverId}: spawn timeout`));
          }
        }
      }, 100);
    });

    const stdioProcess: StdioProcess = {
      serverId,
      process: child,
      config,
      responseBuffer: new ResponseBuffer(),
      initialized: false,
      initializing: false,
      lastUsed: new Date(),
      requestQueue: [],
      processing: false,
      crashCount: 0,
    };

    // Handle stdout - feed to response buffer
    child.stdout?.on('data', (data: Buffer) => {
      stdioProcess.responseBuffer.feed(data);
    });

    // Handle stderr - log warnings
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) {
          logger.warn(`[${serverId}] stderr: ${line}`);
        }
      }
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      logger.info(`[${serverId}] Process exited with code ${code}, signal ${signal}`);
      this.cleanupProcess(serverId, `Process exited with code ${code}`);
    });

    // Handle process errors
    child.on('error', (error) => {
      logger.error(`[${serverId}] Process error`, error);
      this.cleanupProcess(serverId, `Process error: ${error.message}`);
    });

    this.processes.set(serverId, stdioProcess);

    logger.info(`[${serverId}] Spawned process with PID ${child.pid}`);

    return stdioProcess;
  }

  /**
   * Initialize a STDIO process with MCP handshake
   */
  private async initialize(stdioProcess: StdioProcess): Promise<void> {
    if (stdioProcess.initialized) {
      return;
    }

    if (stdioProcess.initializing) {
      // Wait for ongoing initialization
      throw new ProxyError('Process is currently initializing');
    }

    stdioProcess.initializing = true;

    try {
      const initRequest: McpRequest = {
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: 'gird-agent',
            version: '1.0.0',
          },
        },
      };

      logger.debug(`[${stdioProcess.serverId}] Sending initialize request`);

      const response = await this.sendRequestInternal(stdioProcess, initRequest);

      if (response.error) {
        throw new ProxyError(`Initialize failed: ${response.error.message}`);
      }

      // Send initialized notification
      const initializedNotification: McpNotification = {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      };

      this.writeNotification(stdioProcess, initializedNotification);

      stdioProcess.initialized = true;
      logger.info(`[${stdioProcess.serverId}] Process initialized successfully`);
    } finally {
      stdioProcess.initializing = false;
    }
  }

  /**
   * Send a request to a STDIO process and wait for response
   * Includes automatic retry on process failure
   */
  async sendRequest(
    serverId: string,
    config: StdioServerConfig,
    request: McpRequest,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT
  ): Promise<McpResponse> {
    return new Promise((resolve, reject) => {
      // Get or create process
      this.getOrCreateProcess(serverId, config)
        .then((stdioProcess) => {
          if (!stdioProcess) {
            reject(new ProxyError(`Failed to get process for server ${serverId}`));
            return;
          }

          // Add to queue with retry count
          stdioProcess.requestQueue.push({
            request,
            resolve: (res) => resolve(res),
            reject: (err) => reject(err),
            retryCount: 0,
          });

          // Process queue
          this.processQueue(serverId, config, timeoutMs).catch(reject);
        })
        .catch(reject);
    });
  }

  /**
   * Get existing process or spawn a new one
   * Handles concurrent calls by sharing the spawn promise
   */
  private async getOrCreateProcess(
    serverId: string,
    config: StdioServerConfig
  ): Promise<StdioProcess | null> {
    const existing = this.processes.get(serverId);

    // If spawn is in progress, wait for it
    if (existing?.spawnPromise) {
      return existing.spawnPromise;
    }

    // Check if existing process is still alive
    if (existing && existing.process && !existing.process.killed && existing.process.exitCode === null) {
      existing.lastUsed = new Date();
      return existing;
    }

    // Clean up dead process if it exists
    if (existing && existing.process) {
      this.cleanupProcess(serverId, 'Process died');
    }

    // Check crash rate - don't respawn if crashing too frequently
    if (existing && existing.crashCount >= MAX_RETRIES) {
      const timeSinceLastCrash = existing.lastCrashTime
        ? Date.now() - existing.lastCrashTime.getTime()
        : Infinity;

      // Reset crash count if it's been more than 60 seconds
      if (timeSinceLastCrash > 60000) {
        existing.crashCount = 0;
      } else {
        logger.error(`[${serverId}] Process crashed ${existing.crashCount} times, refusing to respawn`);
        return null;
      }
    }

    // Spawn new process and store promise for concurrent callers
    const spawnPromise = this.spawn(serverId, config);

    // Store the promise temporarily for concurrent callers
    // (the spawn method will set the actual process in this.processes)
    const tempEntry = {
      spawnPromise,
    } as Partial<StdioProcess>;
    this.processes.set(serverId, tempEntry as StdioProcess);

    try {
      const result = await spawnPromise;
      return result;
    } catch (error) {
      // Clean up on spawn failure
      this.processes.delete(serverId);
      throw error;
    }
  }

  /**
   * Process the request queue for a server
   */
  private async processQueue(
    serverId: string,
    config: StdioServerConfig,
    timeoutMs: number
  ): Promise<void> {
    const stdioProcess = await this.getOrCreateProcess(serverId, config);

    if (!stdioProcess) {
      // Process is crashed and won't restart - need to reject queued requests
      // Get the stale process entry to access its queue
      const staleProcess = this.processes.get(serverId);
      const queue = staleProcess?.requestQueue ?? [];
      for (const item of queue) {
        item.reject(new ProxyError(`Server ${serverId} is unavailable due to repeated crashes`));
      }
      if (staleProcess) {
        staleProcess.requestQueue = [];
      }
      return;
    }

    if (stdioProcess.processing) {
      return; // Already processing
    }

    stdioProcess.processing = true;

    try {
      // Initialize if needed
      if (!stdioProcess.initialized) {
        await this.initialize(stdioProcess);
      }

      // Process queued requests
      while (stdioProcess.requestQueue.length > 0) {
        const item = stdioProcess.requestQueue.shift();
        if (!item) break;

        try {
          const response = await this.sendRequestInternal(stdioProcess, item.request, timeoutMs);
          // Reset crash count on successful request
          stdioProcess.crashCount = 0;
          item.resolve(response);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Check if this is a retryable error (timeout, process death)
          const isRetryable =
            errorMessage.includes('timed out') ||
            errorMessage.includes('Process') ||
            errorMessage.includes('stdin not available');

          if (isRetryable && item.retryCount < MAX_RETRIES) {
            item.retryCount++;
            logger.warn(`[${serverId}] Retrying request (attempt ${item.retryCount}/${MAX_RETRIES})`);

            // Wait before retry
            await new Promise((r) => setTimeout(r, RETRY_DELAY));

            // Try to respawn process
            const newProcess = await this.getOrCreateProcess(serverId, config);
            if (newProcess) {
              // Re-add to front of queue
              stdioProcess.requestQueue.unshift(item);
              continue;
            }
          }

          item.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }
    } finally {
      stdioProcess.processing = false;
    }
  }

  /**
   * Internal: send request and wait for response
   */
  private async sendRequestInternal(
    stdioProcess: StdioProcess,
    request: McpRequest,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT
  ): Promise<McpResponse> {
    return new Promise((resolve, reject) => {
      // Set up response listener first
      const responsePromise = stdioProcess.responseBuffer.waitForResponse(
        request.id,
        timeoutMs
      );

      // Write request to stdin
      try {
        this.writeRequest(stdioProcess, request);
      } catch (error) {
        stdioProcess.responseBuffer.cancelRequest(
          request.id,
          error instanceof Error ? error.message : String(error)
        );
        reject(error);
        return;
      }

      // Wait for response
      responsePromise.then(resolve).catch(reject);
    });
  }

  /**
   * Write a request to the process stdin
   */
  private writeRequest(stdioProcess: StdioProcess, request: McpRequest): void {
    const stdin = stdioProcess.process.stdin;

    if (!stdin || stdin.destroyed) {
      throw new ProxyError(`Process stdin not available for server ${stdioProcess.serverId}`);
    }

    const line = JSON.stringify(request) + '\n';
    stdin.write(line);

    logger.debug(`[${stdioProcess.serverId}] Sent request`, { id: request.id, method: request.method });
  }

  /**
   * Write a notification to the process stdin (no id required)
   */
  private writeNotification(stdioProcess: StdioProcess, notification: McpNotification): void {
    const stdin = stdioProcess.process.stdin;

    if (!stdin || stdin.destroyed) {
      throw new ProxyError(`Process stdin not available for server ${stdioProcess.serverId}`);
    }

    const line = JSON.stringify(notification) + '\n';
    stdin.write(line);

    logger.debug(`[${stdioProcess.serverId}] Sent notification`, { method: notification.method });
  }

  /**
   * Register an externally-managed process (e.g., from deployment manager)
   */
  registerExternalProcess(serverId: string, process: ChildProcess, config: StdioServerConfig): void {
    logger.info(`Registering external process for server: ${serverId}`);

    const stdioProcess: StdioProcess = {
      serverId,
      process,
      config,
      responseBuffer: new ResponseBuffer(),
      initialized: false,
      initializing: false,
      lastUsed: new Date(),
      requestQueue: [],
      processing: false,
      crashCount: 0,
    };

    // Handle stdout
    process.stdout?.on('data', (data: Buffer) => {
      stdioProcess.responseBuffer.feed(data);
    });

    // Handle stderr
    process.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line) {
          logger.warn(`[${serverId}] stderr: ${line}`);
        }
      }
    });

    // Handle process exit
    process.on('exit', (code, signal) => {
      logger.info(`[${serverId}] External process exited with code ${code}, signal ${signal}`);
      this.cleanupProcess(serverId, `Process exited with code ${code}`);
    });

    process.on('error', (error) => {
      logger.error(`[${serverId}] External process error`, error);
      this.cleanupProcess(serverId, `Process error: ${error.message}`);
    });

    this.processes.set(serverId, stdioProcess);
  }

  /**
   * Terminate a process
   */
  async terminate(serverId: string): Promise<void> {
    const stdioProcess = this.processes.get(serverId);
    if (!stdioProcess) {
      return;
    }

    logger.info(`Terminating process for server: ${serverId}`);

    // Cancel all pending requests
    stdioProcess.responseBuffer.cancelAll('Process terminating');

    // Reject queued requests
    for (const item of stdioProcess.requestQueue) {
      item.reject(new ProxyError('Process terminating'));
    }
    stdioProcess.requestQueue = [];

    const process = stdioProcess.process;

    if (process.killed || process.exitCode !== null) {
      this.processes.delete(serverId);
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (!process.killed && process.exitCode === null) {
          logger.warn(`[${serverId}] Force killing process after timeout`);
          process.kill('SIGKILL');
        }
        this.processes.delete(serverId);
        resolve();
      }, SHUTDOWN_TIMEOUT);

      process.once('exit', () => {
        clearTimeout(timeout);
        this.processes.delete(serverId);
        resolve();
      });

      // Try graceful shutdown
      process.kill('SIGTERM');
    });
  }

  /**
   * Clean up a process entry
   */
  private cleanupProcess(serverId: string, reason: string): void {
    const stdioProcess = this.processes.get(serverId);
    if (!stdioProcess) {
      return;
    }

    logger.info(`[${serverId}] Cleaning up process: ${reason}`);

    // Track crash for rate limiting
    stdioProcess.crashCount++;
    stdioProcess.lastCrashTime = new Date();

    // Cancel pending requests
    stdioProcess.responseBuffer.cancelAll(reason);

    // Reject queued requests
    for (const item of stdioProcess.requestQueue) {
      item.reject(new ProxyError(`Process cleanup: ${reason}`));
    }

    this.processes.delete(serverId);
  }

  /**
   * Check if a process exists and is running
   */
  has(serverId: string): boolean {
    const stdioProcess = this.processes.get(serverId);
    return stdioProcess !== undefined && !stdioProcess.process.killed && stdioProcess.process.exitCode === null;
  }

  /**
   * Get process status
   */
  getStatus(serverId: string): { running: boolean; pid?: number; initialized?: boolean } {
    const stdioProcess = this.processes.get(serverId);
    if (!stdioProcess) {
      return { running: false };
    }

    const running = !stdioProcess.process.killed && stdioProcess.process.exitCode === null;
    const pid = stdioProcess.process.pid;

    return {
      running,
      ...(pid !== undefined && { pid }),
      initialized: stdioProcess.initialized,
    };
  }

  /**
   * Terminate all processes
   */
  async terminateAll(): Promise<void> {
    logger.info('Terminating all STDIO processes');

    const terminations = Array.from(this.processes.keys()).map((serverId) =>
      this.terminate(serverId)
    );

    await Promise.all(terminations);
  }
}

// Export singleton instance
export const stdioProcessPool = new StdioProcessPool();

// Export class for testing
export { StdioProcessPool };
