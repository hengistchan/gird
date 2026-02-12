import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResponseBuffer } from '../response-buffer.js';
import type { McpResponse } from '@gird-mcp/core';

/**
 * Helper to create a valid MCP response
 */
function createResponse(id: string | number, result?: unknown, error?: McpResponse['error']): McpResponse {
  const response: McpResponse = {
    jsonrpc: '2.0',
    id,
  };
  if (result !== undefined) response.result = result;
  if (error !== undefined) response.error = error;
  return response;
}

/**
 * Helper to convert string to Buffer
 */
function toBuffer(data: string): Buffer {
  return Buffer.from(data, 'utf-8');
}

describe('ResponseBuffer', () => {
  let buffer: ResponseBuffer;

  beforeEach(() => {
    buffer = new ResponseBuffer();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('feed() - single complete JSON line', () => {
    it('should parse a single complete JSON line and route to waiting request', async () => {
      const responsePromise = buffer.waitForResponse('test-id-1');
      const response = createResponse('test-id-1', { status: 'ok' });

      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      await expect(responsePromise).resolves.toEqual(response);
    });

    it('should parse response with numeric id', async () => {
      const responsePromise = buffer.waitForResponse(123);
      const response = createResponse(123, { data: 'test' });

      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      await expect(responsePromise).resolves.toEqual(response);
    });

    it('should handle response with error', async () => {
      const responsePromise = buffer.waitForResponse('err-id');
      const response = createResponse('err-id', undefined, {
        code: -32600,
        message: 'Invalid Request',
      });

      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      await expect(responsePromise).resolves.toEqual(response);
    });
  });

  describe('feed() - multiple JSON lines at once', () => {
    it('should parse multiple JSON lines in a single chunk', async () => {
      const promise1 = buffer.waitForResponse('id-1');
      const promise2 = buffer.waitForResponse('id-2');
      const promise3 = buffer.waitForResponse('id-3');

      const response1 = createResponse('id-1', { value: 1 });
      const response2 = createResponse('id-2', { value: 2 });
      const response3 = createResponse('id-3', { value: 3 });

      const multiLineData = [
        JSON.stringify(response1),
        JSON.stringify(response2),
        JSON.stringify(response3),
      ].join('\n') + '\n';

      buffer.feed(toBuffer(multiLineData));

      const [result1, result2, result3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      expect(result1).toEqual(response1);
      expect(result2).toEqual(response2);
      expect(result3).toEqual(response3);
    });

    it('should handle empty lines between JSON objects', async () => {
      const promise = buffer.waitForResponse('test-id');
      const response = createResponse('test-id', { data: 'test' });

      // Include empty lines
      const data = '\n\n' + JSON.stringify(response) + '\n\n';
      buffer.feed(toBuffer(data));

      await expect(promise).resolves.toEqual(response);
    });

    it('should handle lines with only whitespace', async () => {
      const promise = buffer.waitForResponse('test-id');
      const response = createResponse('test-id', { data: 'test' });

      // Include lines with spaces and tabs
      const data = '   \n\t\n' + JSON.stringify(response) + '\n   \n';
      buffer.feed(toBuffer(data));

      await expect(promise).resolves.toEqual(response);
    });
  });

  describe('feed() - partial JSON across multiple chunks', () => {
    it('should buffer partial JSON and parse when complete', async () => {
      const responsePromise = buffer.waitForResponse('partial-id');
      const response = createResponse('partial-id', { data: 'split across chunks' });
      const fullJson = JSON.stringify(response) + '\n';

      // Split into multiple chunks
      const chunk1 = fullJson.slice(0, 10);
      const chunk2 = fullJson.slice(10, 25);
      const chunk3 = fullJson.slice(25);

      buffer.feed(toBuffer(chunk1));
      buffer.feed(toBuffer(chunk2));
      buffer.feed(toBuffer(chunk3));

      await expect(responsePromise).resolves.toEqual(response);
    });

    it('should handle partial JSON without newline', async () => {
      const promise = buffer.waitForResponse('partial-no-newline');
      const response = createResponse('partial-no-newline', { test: true });
      const fullJson = JSON.stringify(response);

      // Feed partial without newline
      buffer.feed(toBuffer(fullJson.slice(0, 20)));

      // Promise should still be pending
      // Advance timers a bit - should not resolve yet
      vi.advanceTimersByTime(100);

      // Feed the rest with newline
      buffer.feed(toBuffer(fullJson.slice(20) + '\n'));

      await expect(promise).resolves.toEqual(response);
    });

    it('should accumulate data correctly across many small chunks', async () => {
      const responsePromise = buffer.waitForResponse('many-chunks');
      const response = createResponse('many-chunks', {
        longString: 'a'.repeat(100),
        nested: { deeply: { nested: { value: 42 } } },
      });
      const fullJson = JSON.stringify(response) + '\n';

      // Feed character by character
      for (let i = 0; i < fullJson.length; i++) {
        buffer.feed(toBuffer(fullJson[i]!));
      }

      await expect(responsePromise).resolves.toEqual(response);
    });
  });

  describe('waitForResponse()', () => {
    it('should resolve with response when id matches', async () => {
      const promise = buffer.waitForResponse('valid-id');
      const response = createResponse('valid-id', { success: true });

      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      const result = await promise;
      expect(result).toEqual(response);
      expect(result.id).toBe('valid-id');
      expect(result.result).toEqual({ success: true });
    });

    it('should reject for duplicate request id', async () => {
      // First request with this ID
      buffer.waitForResponse('duplicate-id');

      // Second request with same ID should reject immediately
      await expect(buffer.waitForResponse('duplicate-id')).rejects.toThrow(
        'Duplicate request id: duplicate-id'
      );
    });

    it('should track pending count correctly', () => {
      expect(buffer.pendingCount).toBe(0);

      buffer.waitForResponse('id-1');
      expect(buffer.pendingCount).toBe(1);

      buffer.waitForResponse('id-2');
      expect(buffer.pendingCount).toBe(2);

      // Resolve one
      const response = createResponse('id-1', {});
      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      expect(buffer.pendingCount).toBe(1);
    });
  });

  describe('waitForResponse() - timeout', () => {
    it('should reject with timeout error after specified duration', async () => {
      const timeoutMs = 5000;
      const promise = buffer.waitForResponse('timeout-id', timeoutMs);

      // Advance time just before timeout
      vi.advanceTimersByTime(timeoutMs - 1);
      // Promise should still be pending, so let's check it doesn't reject yet
      // We'll use a spy to track rejections

      // Advance past timeout
      vi.advanceTimersByTime(2);

      await expect(promise).rejects.toThrow(
        `Request timeout-id timed out after ${timeoutMs}ms`
      );
    });

    it('should use default timeout of 30000ms when not specified', async () => {
      const promise = buffer.waitForResponse('default-timeout-id');

      // Advance 29999ms - should not timeout yet
      vi.advanceTimersByTime(29999);

      // Provide response just before timeout
      const response = createResponse('default-timeout-id', { ok: true });
      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      // Should resolve successfully
      await expect(promise).resolves.toEqual(response);
    });

    it('should timeout at default 30000ms', async () => {
      const promise = buffer.waitForResponse('default-timeout');

      vi.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow(
        'Request default-timeout timed out after 30000ms'
      );
    });

    it('should clean up pending request after timeout', async () => {
      const promise = buffer.waitForResponse('cleanup-id', 1000);

      expect(buffer.pendingCount).toBe(1);

      vi.advanceTimersByTime(1000);

      // Wait for the promise to reject
      await expect(promise).rejects.toThrow();

      // Pending request should be removed
      expect(buffer.pendingCount).toBe(0);
    });
  });

  describe('cancelRequest()', () => {
    it('should reject the waiting promise with cancellation reason', async () => {
      const promise = buffer.waitForResponse('cancel-id');

      buffer.cancelRequest('cancel-id', 'User aborted');

      await expect(promise).rejects.toThrow(
        'Request cancel-id cancelled: User aborted'
      );
    });

    it('should remove the pending request', async () => {
      const promise = buffer.waitForResponse('cancel-id');
      expect(buffer.pendingCount).toBe(1);

      buffer.cancelRequest('cancel-id', 'Test cancellation');

      expect(buffer.pendingCount).toBe(0);

      // Handle the rejection to avoid unhandled rejection warning
      await expect(promise).rejects.toThrow('cancelled');
    });

    it('should be safe to call for non-existent request', () => {
      // Should not throw
      expect(() => buffer.cancelRequest('non-existent', 'No reason')).not.toThrow();
    });

    it('should clear the timeout when cancelling', async () => {
      const promise = buffer.waitForResponse('cancel-timeout-id', 1000);

      buffer.cancelRequest('cancel-timeout-id', 'Cancelled before timeout');

      // Advance past original timeout
      vi.advanceTimersByTime(2000);

      // Should reject with cancellation error, not timeout
      await expect(promise).rejects.toThrow('cancelled: Cancelled before timeout');
    });
  });

  describe('cancelAll()', () => {
    it('should reject all waiting promises', async () => {
      const promise1 = buffer.waitForResponse('cancel-all-1');
      const promise2 = buffer.waitForResponse('cancel-all-2');
      const promise3 = buffer.waitForResponse('cancel-all-3');

      buffer.cancelAll('Server shutting down');

      await expect(promise1).rejects.toThrow(
        'Request cancel-all-1 cancelled: Server shutting down'
      );
      await expect(promise2).rejects.toThrow(
        'Request cancel-all-2 cancelled: Server shutting down'
      );
      await expect(promise3).rejects.toThrow(
        'Request cancel-all-3 cancelled: Server shutting down'
      );
    });

    it('should clear all pending requests', async () => {
      const promise1 = buffer.waitForResponse('id-1');
      const promise2 = buffer.waitForResponse('id-2');
      const promise3 = buffer.waitForResponse('id-3');

      expect(buffer.pendingCount).toBe(3);

      buffer.cancelAll('Clearing all');

      expect(buffer.pendingCount).toBe(0);

      // Handle the rejections to avoid unhandled rejection warnings
      await Promise.all([
        expect(promise1).rejects.toThrow('cancelled'),
        expect(promise2).rejects.toThrow('cancelled'),
        expect(promise3).rejects.toThrow('cancelled'),
      ]);
    });

    it('should be safe to call when no pending requests exist', () => {
      expect(buffer.pendingCount).toBe(0);
      expect(() => buffer.cancelAll('No requests')).not.toThrow();
      expect(buffer.pendingCount).toBe(0);
    });

    it('should clear all timeouts', async () => {
      const promise1 = buffer.waitForResponse('timeout-1', 1000);
      const promise2 = buffer.waitForResponse('timeout-2', 2000);
      const promise3 = buffer.waitForResponse('timeout-3', 3000);

      buffer.cancelAll('Cancelling all');

      // Advance way past all timeouts
      vi.advanceTimersByTime(5000);

      // All promises already rejected, no further action
      expect(buffer.pendingCount).toBe(0);

      // Handle the rejections to avoid unhandled rejection warnings
      await Promise.all([
        expect(promise1).rejects.toThrow('cancelled'),
        expect(promise2).rejects.toThrow('cancelled'),
        expect(promise3).rejects.toThrow('cancelled'),
      ]);
    });
  });

  describe('Multiple concurrent requests with different IDs', () => {
    it('should route responses to correct waiting requests', async () => {
      const promiseA = buffer.waitForResponse('request-a');
      const promiseB = buffer.waitForResponse('request-b');
      const promiseC = buffer.waitForResponse('request-c');

      // Send responses in different order than created
      const responseB = createResponse('request-b', { handler: 'B' });
      const responseA = createResponse('request-a', { handler: 'A' });
      const responseC = createResponse('request-c', { handler: 'C' });

      buffer.feed(toBuffer(JSON.stringify(responseB) + '\n'));
      buffer.feed(toBuffer(JSON.stringify(responseA) + '\n'));
      buffer.feed(toBuffer(JSON.stringify(responseC) + '\n'));

      const [resultA, resultB, resultC] = await Promise.all([
        promiseA,
        promiseB,
        promiseC,
      ]);

      // Each should get its correct response
      expect(resultA).toEqual(responseA);
      expect(resultB).toEqual(responseB);
      expect(resultC).toEqual(responseC);
    });

    it('should handle mix of numeric and string IDs', async () => {
      const promise1 = buffer.waitForResponse(1);
      const promise2 = buffer.waitForResponse('2');
      const promise3 = buffer.waitForResponse(3);

      const response1 = createResponse(1, { type: 'number' });
      const response2 = createResponse('2', { type: 'string' });
      const response3 = createResponse(3, { type: 'number-again' });

      buffer.feed(toBuffer(
        JSON.stringify(response1) + '\n' +
        JSON.stringify(response2) + '\n' +
        JSON.stringify(response3) + '\n'
      ));

      const [result1, result2, result3] = await Promise.all([
        promise1,
        promise2,
        promise3,
      ]);

      expect(result1).toEqual(response1);
      expect(result2).toEqual(response2);
      expect(result3).toEqual(response3);
    });

    it('should ignore responses for unknown IDs (no waiting request)', () => {
      // No waiting request for 'unknown-id'
      const response = createResponse('unknown-id', { orphan: true });

      // Should not throw, just log a warning
      expect(() => {
        buffer.feed(toBuffer(JSON.stringify(response) + '\n'));
      }).not.toThrow();
    });

    it('should handle high concurrency', async () => {
      const numRequests = 100;
      const promises: Promise<McpResponse>[] = [];

      for (let i = 0; i < numRequests; i++) {
        promises.push(buffer.waitForResponse(`concurrent-${i}`));
      }

      expect(buffer.pendingCount).toBe(numRequests);

      // Create and send all responses
      const responses: McpResponse[] = [];
      let data = '';
      for (let i = 0; i < numRequests; i++) {
        const response = createResponse(`concurrent-${i}`, { index: i });
        responses.push(response);
        data += JSON.stringify(response) + '\n';
      }

      buffer.feed(toBuffer(data));

      const results = await Promise.all(promises);

      expect(results.length).toBe(numRequests);
      results.forEach((result, i) => {
        expect(result).toEqual(responses[i]);
      });

      expect(buffer.pendingCount).toBe(0);
    });
  });

  describe('reset()', () => {
    it('should clear the buffer', async () => {
      // Feed partial data without newline
      buffer.feed(toBuffer('{"partial":'));

      // Reset
      buffer.reset();

      // Start fresh with a new response
      const promise = buffer.waitForResponse('after-reset');
      const response = createResponse('after-reset', { fresh: true });

      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      await expect(promise).resolves.toEqual(response);
    });

    it('should cancel all pending requests', async () => {
      const promise1 = buffer.waitForResponse('reset-1');
      const promise2 = buffer.waitForResponse('reset-2');

      expect(buffer.pendingCount).toBe(2);

      buffer.reset();

      expect(buffer.pendingCount).toBe(0);

      // Handle the rejections to avoid unhandled rejection warnings
      await Promise.all([
        expect(promise1).rejects.toThrow('cancelled'),
        expect(promise2).rejects.toThrow('cancelled'),
      ]);
    });
  });

  describe('Edge cases', () => {
    it('should ignore non-JSON-RPC 2.0 responses', async () => {
      const promise = buffer.waitForResponse('test-id');

      // Send invalid JSON-RPC version
      buffer.feed(toBuffer('{"jsonrpc":"1.0","id":"test-id","result":{}}\n'));

      // Promise should still be pending - wait for timeout
      vi.advanceTimersByTime(30000);

      await expect(promise).rejects.toThrow('timed out');
    });

    it('should handle invalid JSON gracefully', () => {
      // No waiting request, but should not throw on invalid JSON
      expect(() => {
        buffer.feed(toBuffer('not valid json at all\n'));
      }).not.toThrow();
    });

    it('should handle responses without id (notifications)', () => {
      // Notification has no id
      expect(() => {
        buffer.feed(toBuffer('{"jsonrpc":"2.0","method":"notification","params":{}}\n'));
      }).not.toThrow();
    });

    it('should handle very large JSON responses', async () => {
      const promise = buffer.waitForResponse('large-response');
      const largeData = { data: 'x'.repeat(100000) };
      const response = createResponse('large-response', largeData);

      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      const result = await promise;
      expect(result.result).toEqual(largeData);
    });

    it('should handle unicode in responses', async () => {
      const promise = buffer.waitForResponse('unicode-id');
      const response = createResponse('unicode-id', {
        message: 'Hello 世界 😀 éè',
      });

      buffer.feed(toBuffer(JSON.stringify(response) + '\n'));

      await expect(promise).resolves.toEqual(response);
    });

    it('should handle null and undefined result values', async () => {
      const promiseNull = buffer.waitForResponse('null-result');
      const responseNull = createResponse('null-result', null);

      buffer.feed(toBuffer(JSON.stringify(responseNull) + '\n'));

      const result = await promiseNull;
      expect(result.result).toBeNull();
    });
  });
});
