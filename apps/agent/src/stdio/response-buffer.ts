/**
 * Response buffer for handling newline-delimited JSON-RPC responses
 * STDIO servers may send partial JSON across multiple stdout chunks
 */

import { createLogger } from '@gird/core';
import type { McpResponse } from '@gird/core';

const logger = createLogger('stdio:buffer');

/**
 * Pending request tracker for correlating responses
 */
interface PendingRequest {
  resolve: (response: McpResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * Response buffer that handles partial JSON chunks and request/response correlation
 */
export class ResponseBuffer {
  private buffer = '';
  private pendingRequests = new Map<string | number, PendingRequest>();

  /**
   * Feed data from stdout into the buffer
   * Parses complete lines and routes responses to waiting requests
   */
  feed(data: Buffer): void {
    this.buffer += data.toString('utf-8');
    this.tryParseLines();
  }

  /**
   * Try to parse complete lines from the buffer
   */
  private tryParseLines(): void {
    const lines = this.buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const response = JSON.parse(trimmed) as McpResponse;

        // Validate it's a valid JSON-RPC response
        if (response.jsonrpc !== '2.0') {
          logger.warn('Received non-JSON-RPC 2.0 response', { response });
          continue;
        }

        // Route to waiting request if there's an ID
        if (response.id !== undefined) {
          this.routeResponse(response);
        } else {
          // This might be a notification - log it
          logger.debug('Received notification (no id)', { response });
        }
      } catch (error) {
        logger.warn('Failed to parse JSON line', {
          line: trimmed.substring(0, 100),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Route a response to its waiting request
   */
  private routeResponse(response: McpResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      logger.warn('Received response for unknown request id', { id: response.id });
      return;
    }

    // Clear the timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);

    // Resolve the promise
    pending.resolve(response);
  }

  /**
   * Register a pending request and wait for its response
   * @param id - The JSON-RPC request id
   * @param timeoutMs - Timeout in milliseconds (default 30s)
   * @returns Promise that resolves with the response
   */
  waitForResponse(id: string | number, timeoutMs = 30000): Promise<McpResponse> {
    return new Promise((resolve, reject) => {
      // Check for duplicate request ID
      if (this.pendingRequests.has(id)) {
        reject(new Error(`Duplicate request id: ${id}`));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve,
        reject,
        timeout,
      });
    });
  }

  /**
   * Cancel a pending request
   */
  cancelRequest(id: string | number, reason: string): void {
    const pending = this.pendingRequests.get(id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(id);
      pending.reject(new Error(`Request ${id} cancelled: ${reason}`));
    }
  }

  /**
   * Cancel all pending requests
   */
  cancelAll(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Request ${id} cancelled: ${reason}`));
    }
    this.pendingRequests.clear();
  }

  /**
   * Reset the buffer and cancel all pending requests
   */
  reset(): void {
    this.buffer = '';
    this.cancelAll('Buffer reset');
  }

  /**
   * Get the number of pending requests
   */
  get pendingCount(): number {
    return this.pendingRequests.size;
  }
}
