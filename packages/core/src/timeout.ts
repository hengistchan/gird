/**
 * Timeout utilities for operations that may hang
 */

/**
 * Wrap a promise with a timeout
 * @param promise - The promise to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param errorMessage - Optional custom error message
 * @returns The promise result or throws on timeout
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage?: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // Ensure timeout is cleaned up if promise resolves
    promise.finally(() => clearTimeout(timeoutHandle));
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Create an AbortController that will abort after a specified timeout
 * @param timeoutMs - Timeout in milliseconds
 * @returns AbortController instance
 */
export function createTimeoutController(timeoutMs: number): AbortController {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller;
}

/**
 * Create an AbortSignal that will abort after a specified timeout
 * This is a convenience wrapper around AbortSignal.timeout (available in newer Node versions)
 * @param timeoutMs - Timeout in milliseconds
 * @returns AbortSignal instance
 */
export function createTimeoutSignal(timeoutMs: number): AbortSignal {
  // Prefer native AbortSignal.timeout if available (Node 16.17+)
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }

  // Fallback for older Node versions
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

/**
 * Default timeout values for different operations (in milliseconds)
 */
export const DEFAULT_TIMEOUTS = {
  /** Timeout for HTTP proxy requests (30 seconds) */
  PROXY_REQUEST: 30000,
  /** Timeout for Docker commands (60 seconds) */
  DOCKER_COMMAND: 60000,
  /** Timeout for agent API calls (30 seconds) */
  AGENT_REQUEST: 30000,
  /** Timeout for deployment operations (120 seconds) */
  DEPLOYMENT_OPERATION: 120000,
} as const;
