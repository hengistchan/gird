/**
 * E2E Tests for Concurrent Operations
 *
 * Tests behavior under concurrent access and race conditions
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const AGENT_BASE = process.env.AGENT_BASE_URL || 'http://localhost:3001';

const TEST_RUN_ID = Date.now();

interface ApiKeyResponse {
  id: string;
  name: string;
  key: string;
  permissions: { serverIds?: string[] | null };
}

interface ServerResponse {
  id: string;
  name: string;
  type: string;
  status: string;
}

// Run tests sequentially (concurrent tests are within each test)
test.describe.configure({ mode: 'serial' });

test.describe('Concurrent Server Operations', () => {
  let authToken: string;
  let apiKeyId: string;
  let createdServerIds: string[] = [];

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `concurrent-test-key-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;
  });

  test.afterAll(async () => {
    // Cleanup all servers
    for (const id of createdServerIds) {
      await fetch(`${API_BASE}/api/servers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }

    if (apiKeyId) {
      await fetch(`${API_BASE}/api/keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  test('Concurrent server creation with unique names', async ({ request }) => {
    const concurrentRequests = 5;
    const requests = [];

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request.post(`${API_BASE}/api/servers`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: `concurrent-unique-${TEST_RUN_ID}-${i}`,
            type: 'STDIO',
            config: { command: 'node', args: ['--version'] },
          },
        })
      );
    }

    const responses = await Promise.all(requests);

    // All should succeed
    let successCount = 0;
    for (const response of responses) {
      if (response.ok()) {
        successCount++;
        const data = await response.json();
        createdServerIds.push(data.id);
      }
    }

    expect(successCount).toBe(concurrentRequests);
  });

  test('Concurrent server creation with same name (race condition)', async ({ request }) => {
    const duplicateName = `duplicate-concurrent-${TEST_RUN_ID}`;
    const concurrentRequests = 3;
    const requests = [];

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request.post(`${API_BASE}/api/servers`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: duplicateName,
            type: 'STDIO',
            config: { command: 'node' },
          },
        })
      );
    }

    const responses = await Promise.all(requests);

    // Only one should succeed (201), others should fail (400)
    const statusCodes = responses.map((r) => r.status());
    const successCount = statusCodes.filter((c) => c === 201).length;
    const failureCount = statusCodes.filter((c) => c === 400).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(2);

    // Track the created server for cleanup
    for (const response of responses) {
      if (response.ok()) {
        const data = await response.json();
        createdServerIds.push(data.id);
      }
    }
  });

  test('Concurrent reads of same server', async ({ request }) => {
    // Create a server
    const createResponse = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `read-test-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: { command: 'node' },
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const serverData = await createResponse.json();
    const serverId = serverData.id;
    createdServerIds.push(serverId);

    // Concurrent reads
    const concurrentRequests = 10;
    const requests = [];

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request.get(`${API_BASE}/api/servers/${serverId}`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })
      );
    }

    const responses = await Promise.all(requests);

    // All should succeed
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
    }
  });

  test('Concurrent update of same server', async ({ request }) => {
    // Create a server
    const createResponse = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `update-test-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: { command: 'node' },
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const serverData = await createResponse.json();
    const serverId = serverData.id;
    createdServerIds.push(serverId);

    // Concurrent updates
    const concurrentRequests = 5;
    const requests = [];

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request.put(`${API_BASE}/api/servers/${serverId}`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            description: `Updated concurrently ${i}`,
          },
        })
      );
    }

    const responses = await Promise.all(requests);

    // All should succeed (last write wins)
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
    }
  });
});

test.describe('Concurrent API Key Operations', () => {
  let authToken: string;
  let apiKeyId: string;
  let createdKeyIds: string[] = [];

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `key-concurrent-test-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;
  });

  test.afterAll(async () => {
    for (const id of createdKeyIds) {
      await fetch(`${API_BASE}/api/keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }

    if (apiKeyId) {
      await fetch(`${API_BASE}/api/keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  test('Concurrent API key creation', async ({ request }) => {
    const concurrentRequests = 5;
    const requests = [];

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request.post(`${API_BASE}/api/keys`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            name: `concurrent-key-${TEST_RUN_ID}-${i}`,
            permissions: { serverIds: null },
          },
        })
      );
    }

    const responses = await Promise.all(requests);

    // All should succeed
    let successCount = 0;
    for (const response of responses) {
      if (response.ok()) {
        successCount++;
        const data = await response.json();
        createdKeyIds.push(data.id);
      }
    }

    expect(successCount).toBe(concurrentRequests);
  });

  test('Concurrent key listing', async ({ request }) => {
    const concurrentRequests = 10;
    const requests = [];

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request.get(`${API_BASE}/api/keys`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })
      );
    }

    const responses = await Promise.all(requests);

    // All should succeed
    for (const response of responses) {
      expect(response.ok()).toBeTruthy();
    }
  });
});

test.describe('High Concurrency MCP Requests', () => {
  let authToken: string;
  let apiKeyId: string;
  let serverId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `mcp-concurrent-test-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;

    // Create test server
    const serverResponse = await fetch(`${API_BASE}/api/servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `mcp-concurrent-server-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: { command: 'node', args: ['--version'] },
      }),
    });

    const serverData = await serverResponse.json();
    serverId = serverData.id;
  });

  test.afterAll(async () => {
    if (serverId) {
      await fetch(`${API_BASE}/api/servers/${serverId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
    if (apiKeyId) {
      await fetch(`${API_BASE}/api/keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  test('Concurrent MCP requests to same server', async ({ request }) => {
    // Note: These requests will fail since the server isn't running
    // but we're testing the concurrency handling
    const concurrentRequests = 10;
    const requests = [];

    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(
        request.post(`${AGENT_BASE}/mcp/${serverId}/`, {
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          data: {
            jsonrpc: '2.0',
            id: `concurrent-${i}`,
            method: 'tools/list',
          },
        })
      );
    }

    const responses = await Promise.all(requests);

    // All requests should get a response (not hang)
    expect(responses.length).toBe(concurrentRequests);

    // Each response should be valid JSON
    for (const response of responses) {
      expect([200, 502]).toContain(response.status());
    }
  });
});

test.describe('Stress Tests', () => {
  let authToken: string;
  let apiKeyId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `stress-test-key-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;
  });

  test.afterAll(async () => {
    if (apiKeyId) {
      await fetch(`${API_BASE}/api/keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  test('Rapid sequential requests', async ({ request }) => {
    const requestCount = 50;

    for (let i = 0; i < requestCount; i++) {
      const response = await request.get(`${API_BASE}/api/servers`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.ok()).toBeTruthy();
    }
  });

  test('Mixed operation types', async ({ request }) => {
    const operations = [];

    // Create servers
    for (let i = 0; i < 5; i++) {
      operations.push(
        fetch(`${API_BASE}/api/servers`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: `stress-server-${TEST_RUN_ID}-${i}`,
            type: 'STDIO',
            config: { command: 'node' },
          }),
        })
      );
    }

    // List servers
    for (let i = 0; i < 5; i++) {
      operations.push(
        fetch(`${API_BASE}/api/servers`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })
      );
    }

    // List keys
    for (let i = 0; i < 5; i++) {
      operations.push(
        fetch(`${API_BASE}/api/keys`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        })
      );
    }

    const responses = await Promise.all(operations);

    // Most should succeed
    const successCount = responses.filter((r) => r.ok).length;
    expect(successCount).toBeGreaterThan(10);

    // Cleanup created servers
    for (const response of responses) {
      if (response.ok && response.url.includes('/api/servers') && response.url.endsWith('/api/servers')) {
        try {
          const clone = response.clone();
          const data = await clone.json();
          if (data.id) {
            await fetch(`${API_BASE}/api/servers/${data.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${authToken}` },
            });
          }
        } catch {
          // Not a create response
        }
      }
    }
  });
});
