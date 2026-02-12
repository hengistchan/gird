/**
 * Tests for StdioProcessPool
 *
 * Uses mocking for child_process.spawn to avoid spawning real processes in unit tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Writable, PassThrough } from 'node:stream';
import type { StdioServerConfig, McpRequest, McpResponse } from '@gird/core';

// Mock the spawn function
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock the logger
vi.mock('@gird/core', async () => {
  const actual = await vi.importActual('@gird/core');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Import after mocking
import { spawn } from 'node:child_process';
import { StdioProcessPool } from '../process-pool.js';

/**
 * Create a mock ChildProcess instance
 */
function createMockProcess(options: {
  pid?: number;
  killed?: boolean;
  exitCode?: number | null;
  withStdin?: boolean;
  withStdout?: boolean;
  withStderr?: boolean;
  autoRespondToInit?: boolean;
} = {}): ChildProcess {
  const {
    pid = 12345,
    killed = false,
    exitCode = null,
    withStdin = true,
    withStdout = true,
    withStderr = true,
    autoRespondToInit = false,
  } = options;

  const process = new EventEmitter() as ChildProcess;

  // Set required properties
  Object.defineProperty(process, 'pid', {
    value: pid,
    writable: false,
    configurable: true,
  });

  Object.defineProperty(process, 'killed', {
    value: killed,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(process, 'exitCode', {
    value: exitCode,
    writable: true,
    configurable: true,
  });

  // Auto-emit 'spawn' event to simulate successful process start
  // This is needed because the new spawn implementation waits for this event
  setImmediate(() => {
    process.emit('spawn');
  });

  // Create stdin stream
  if (withStdin) {
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    Object.defineProperty(process, 'stdin', {
      value: stdin,
      writable: true,
      configurable: true,
    });
  }

  // Create stdout stream
  if (withStdout) {
    const stdout = new PassThrough();
    Object.defineProperty(process, 'stdout', {
      value: stdout,
      writable: true,
      configurable: true,
    });

    // Auto-respond to initialize requests if enabled
    if (autoRespondToInit) {
      const initResponse: McpResponse = {
        jsonrpc: '2.0',
        id: 'init-1',
        result: {
          capabilities: {},
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'test-server', version: '1.0.0' },
        },
      };

      // Send response after a short delay to simulate async behavior
      setTimeout(() => {
        stdout.write(JSON.stringify(initResponse) + '\n');
      }, 10);
    }
  }

  // Create stderr stream
  if (withStderr) {
    const stderr = new PassThrough();
    Object.defineProperty(process, 'stderr', {
      value: stderr,
      writable: true,
      configurable: true,
    });
  }

  // Mock kill method
  process.kill = vi.fn((signal?: NodeJS.Signals | number) => {
    Object.defineProperty(process, 'killed', {
      value: true,
      writable: true,
      configurable: true,
    });

    // Emit exit event asynchronously
    setImmediate(() => {
      process.emit('exit', 0, signal || null);
    });

    return true;
  });

  return process;
}

/**
 * Create a mock process without pid (failed spawn)
 */
function createMockProcessWithoutPid(): ChildProcess {
  const process = new EventEmitter() as ChildProcess;

  Object.defineProperty(process, 'pid', {
    value: undefined,
    writable: false,
    configurable: true,
  });

  Object.defineProperty(process, 'killed', {
    value: false,
    writable: true,
    configurable: true,
  });

  Object.defineProperty(process, 'exitCode', {
    value: null,
    writable: true,
    configurable: true,
  });

  process.kill = vi.fn(() => true) as unknown as typeof process.kill;

  return process;
}

/**
 * Create a basic STDIO server config for testing
 */
function createTestConfig(): StdioServerConfig {
  return {
    command: 'node',
    args: ['test-server.js'],
    env: { TEST: 'true' },
    cwd: '/tmp/test',
  };
}

/**
 * Send a mock response to stdout
 */
function sendMockResponse(mockProcess: ChildProcess, response: McpResponse): void {
  const stdout = mockProcess.stdout as PassThrough;
  stdout.write(JSON.stringify(response) + '\n');
}

describe('StdioProcessPool', () => {
  let pool: StdioProcessPool;
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pool = new StdioProcessPool();
    mockSpawn = vi.mocked(spawn);
    mockSpawn.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('get()', () => {
    it('creates new process when none exists', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      const result = await pool.get('server-1', config);

      expect(result).toBeDefined();
      expect(result.serverId).toBe('server-1');
      expect(result.config).toBe(config);
      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        ['test-server.js'],
        expect.objectContaining({
          env: expect.any(Object),
          cwd: '/tmp/test',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
    });

    it('returns existing process when alive', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();

      // First call creates the process
      const result1 = await pool.get('server-1', config);

      // Second call should return the same process
      const result2 = await pool.get('server-1', config);

      expect(result2).toBe(result1);
      // spawn should only be called once
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('spawns new process when existing is dead (killed=true)', async () => {
      const mockProcess1 = createMockProcess({ killed: true });
      const mockProcess2 = createMockProcess({ pid: 54321 });

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const config = createTestConfig();

      // First call creates the process (which is already killed)
      const result1 = await pool.get('server-1', config);

      // Second call should spawn a new process
      const result2 = await pool.get('server-1', config);

      expect(result2).not.toBe(result1);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('spawns new process when existing is dead (exitCode set)', async () => {
      const mockProcess1 = createMockProcess({ exitCode: 1 });
      const mockProcess2 = createMockProcess({ pid: 54321 });

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const config = createTestConfig();

      // First call creates the process (which already exited)
      const result1 = await pool.get('server-1', config);

      // Second call should spawn a new process
      const result2 = await pool.get('server-1', config);

      expect(result2).not.toBe(result1);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('throws error when process fails to spawn (no pid)', async () => {
      const mockProcess = createMockProcessWithoutPid();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();

      // The new implementation waits for 'spawn' or 'error' event
      // We need to emit 'error' event to simulate failed spawn
      setTimeout(() => {
        mockProcess.emit('error', new Error('spawn ENOENT'));
      }, 10);

      await expect(pool.get('server-1', config)).rejects.toThrow(
        'Failed to spawn process for server server-1'
      );
    });

    it('merges environment variables correctly', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config: StdioServerConfig = {
        command: 'node',
        args: ['server.js'],
        env: {
          CUSTOM_VAR: 'custom-value',
          NODE_ENV: 'test',
        },
      };

      await pool.get('server-1', config);

      const spawnCall = mockSpawn.mock.calls[0];
      const envArg = spawnCall?.[2]?.env as Record<string, string>;

      expect(envArg).toBeDefined();
      expect(envArg.CUSTOM_VAR).toBe('custom-value');
      expect(envArg.NODE_ENV).toBe('test');
    });
  });

  describe('sendRequest()', () => {
    it('queues and processes requests', async () => {
      const mockProcess = createMockProcess({ autoRespondToInit: true });
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      const request: McpRequest = {
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'tools/list',
        params: {},
      };

      // Set up response for our test request
      const testResponse: McpResponse = {
        jsonrpc: '2.0',
        id: 'test-1',
        result: { tools: [] },
      };

      // Send response after a short delay
      setTimeout(() => {
        sendMockResponse(mockProcess, testResponse);
      }, 50);

      const result = await pool.sendRequest('server-1', config, request, 5000);

      expect(result).toEqual(testResponse);
    });

    it('rejects request on timeout', async () => {
      const mockProcess = createMockProcess({ autoRespondToInit: true });
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      const request: McpRequest = {
        jsonrpc: '2.0',
        id: 'test-timeout',
        method: 'test/method',
      };

      // Don't send any response for our request - let it timeout
      await expect(
        pool.sendRequest('server-1', config, request, 100)
      ).rejects.toThrow(/timed out/);
    });

    it('creates process if not exists', async () => {
      const mockProcess = createMockProcess({ autoRespondToInit: true });
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();

      // Just verify that spawn was called when sending a request
      const request: McpRequest = {
        jsonrpc: '2.0',
        id: 'test-1',
        method: 'tools/list',
        params: {},
      };

      // Set up response for our test request
      const testResponse: McpResponse = {
        jsonrpc: '2.0',
        id: 'test-1',
        result: { tools: [] },
      };

      // Send response after a short delay
      setTimeout(() => {
        sendMockResponse(mockProcess, testResponse);
      }, 50);

      await pool.sendRequest('server-1', config, request, 5000);

      // Should have spawned a process
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });

  describe('terminate()', () => {
    it('kills process gracefully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      await pool.terminate('server-1');

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('does nothing if process does not exist', async () => {
      // Should not throw
      await expect(pool.terminate('nonexistent')).resolves.toBeUndefined();
    });

    it('removes process from map after termination', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      expect(pool.has('server-1')).toBe(true);

      await pool.terminate('server-1');

      // After termination, has() should return false
      expect(pool.has('server-1')).toBe(false);
    });

    it('force kills process after timeout', async () => {
      vi.useFakeTimers();

      const mockProcess = createMockProcess();
      let killCount = 0;

      // Override kill to track calls but not emit exit
      mockProcess.kill = vi.fn((signal?: NodeJS.Signals | number) => {
        killCount++;
        // Don't emit exit - simulate process hanging
        // But mark as killed after SIGKILL
        if (signal === 'SIGKILL') {
          Object.defineProperty(mockProcess, 'killed', {
            value: true,
            writable: true,
            configurable: true,
          });
        }
        return true;
      }) as unknown as typeof mockProcess.kill;

      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      const terminatePromise = pool.terminate('server-1');

      // Advance time past the shutdown timeout (5 seconds)
      await vi.advanceTimersByTimeAsync(5500);

      await terminatePromise;

      // Should have called kill twice - first SIGTERM, then SIGKILL after timeout
      expect(killCount).toBe(2);
      expect(mockProcess.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(mockProcess.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');

      vi.useRealTimers();
    });

    it('handles already killed process', async () => {
      const mockProcess = createMockProcess({ killed: true });
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      // Should not throw and should complete immediately
      await expect(pool.terminate('server-1')).resolves.toBeUndefined();
    });

    it('cancels pending requests on termination', async () => {
      const mockProcess = createMockProcess();
      // Override kill to emit exit synchronously for this test
      mockProcess.kill = vi.fn((signal?: NodeJS.Signals | number) => {
        Object.defineProperty(mockProcess, 'killed', {
          value: true,
          writable: true,
          configurable: true,
        });
        setImmediate(() => {
          mockProcess.emit('exit', 0, signal || null);
        });
        return true;
      }) as unknown as typeof mockProcess.kill;

      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      // Start a request that will be cancelled - attach catch handler immediately
      const requestPromise = pool
        .sendRequest(
          'server-1',
          config,
          {
            jsonrpc: '2.0',
            id: 'pending-1',
            method: 'test/method',
          },
          10000
        )
        .catch((err) => {
          // Expected to be rejected
          return err;
        });

      // Wait a bit for the request to be queued
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Terminate
      await pool.terminate('server-1');

      // Request should be rejected
      const result = await requestPromise;
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toMatch(/terminating|cancelled|cleanup/);
    });
  });

  describe('registerExternalProcess()', () => {
    it('registers process correctly', () => {
      const externalProcess = createMockProcess();
      const config = createTestConfig();

      pool.registerExternalProcess('external-1', externalProcess, config);

      expect(pool.has('external-1')).toBe(true);

      const status = pool.getStatus('external-1');
      expect(status.running).toBe(true);
      expect(status.pid).toBe(12345);
    });

    it('handles stdout from external process', () => {
      const externalProcess = createMockProcess();
      const config = createTestConfig();

      pool.registerExternalProcess('external-1', externalProcess, config);

      // Simulate stdout data (a notification - no id)
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { data: 'test' },
      };

      // This should not throw or cause any errors
      const stdout = externalProcess.stdout as PassThrough;
      stdout.write(JSON.stringify(notification) + '\n');

      // The process should still be registered and running
      expect(pool.has('external-1')).toBe(true);
    });

    it('cleans up on external process exit', async () => {
      const externalProcess = createMockProcess();
      const config = createTestConfig();

      pool.registerExternalProcess('external-1', externalProcess, config);
      expect(pool.has('external-1')).toBe(true);

      // Simulate process exit
      externalProcess.emit('exit', 0, null);

      // Should be cleaned up
      expect(pool.has('external-1')).toBe(false);
    });

    it('handles external process error', async () => {
      const externalProcess = createMockProcess();
      const config = createTestConfig();

      pool.registerExternalProcess('external-1', externalProcess, config);
      expect(pool.has('external-1')).toBe(true);

      // Simulate process error
      externalProcess.emit('error', new Error('Process error'));

      // Should be cleaned up
      expect(pool.has('external-1')).toBe(false);
    });
  });

  describe('has()', () => {
    it('returns true for running process', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      expect(pool.has('server-1')).toBe(true);
    });

    it('returns false for nonexistent process', () => {
      expect(pool.has('nonexistent')).toBe(false);
    });

    it('returns false for killed process', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      // Mark as killed
      Object.defineProperty(mockProcess, 'killed', {
        value: true,
        writable: true,
        configurable: true,
      });

      expect(pool.has('server-1')).toBe(false);
    });

    it('returns false for exited process', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      // Set exit code
      Object.defineProperty(mockProcess, 'exitCode', {
        value: 0,
        writable: true,
        configurable: true,
      });

      expect(pool.has('server-1')).toBe(false);
    });
  });

  describe('getStatus()', () => {
    it('returns correct info for running process', async () => {
      const mockProcess = createMockProcess({ pid: 99999 });
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      const status = pool.getStatus('server-1');

      expect(status.running).toBe(true);
      expect(status.pid).toBe(99999);
      expect(status.initialized).toBe(false);
    });

    it('returns running: false for nonexistent process', () => {
      const status = pool.getStatus('nonexistent');

      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
      expect(status.initialized).toBeUndefined();
    });

    it('returns running: false for killed process', async () => {
      const mockProcess = createMockProcess({ pid: 99999 });
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      // Mark as killed
      Object.defineProperty(mockProcess, 'killed', {
        value: true,
        writable: true,
        configurable: true,
      });

      const status = pool.getStatus('server-1');

      expect(status.running).toBe(false);
      // PID should still be present as the process entry exists
      expect(status.pid).toBe(99999);
    });
  });

  describe('terminateAll()', () => {
    it('terminates all processes', async () => {
      const mockProcess1 = createMockProcess({ pid: 11111 });
      const mockProcess2 = createMockProcess({ pid: 22222 });
      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const config = createTestConfig();
      await pool.get('server-1', config);
      await pool.get('server-2', config);

      expect(pool.has('server-1')).toBe(true);
      expect(pool.has('server-2')).toBe(true);

      await pool.terminateAll();

      expect(pool.has('server-1')).toBe(false);
      expect(pool.has('server-2')).toBe(false);
    });

    it('handles empty pool', async () => {
      // Should not throw
      await expect(pool.terminateAll()).resolves.toBeUndefined();
    });
  });

  describe('process lifecycle events', () => {
    it('cleans up on process exit', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      expect(pool.has('server-1')).toBe(true);

      // Simulate process exit
      mockProcess.emit('exit', 1, null);

      // Process should be cleaned up
      expect(pool.has('server-1')).toBe(false);
    });

    it('cleans up on process error', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      expect(pool.has('server-1')).toBe(true);

      // Simulate process error
      mockProcess.emit('error', new Error('Spawn error'));

      // Process should be cleaned up
      expect(pool.has('server-1')).toBe(false);
    });

    it('handles stderr output without error', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const config = createTestConfig();
      await pool.get('server-1', config);

      // Simulate stderr output
      const stderr = mockProcess.stderr as PassThrough;
      stderr.write('Warning message\n');
      stderr.write('Another warning\n');

      // Should not throw, process should still be alive
      expect(pool.has('server-1')).toBe(true);
    });
  });
});
