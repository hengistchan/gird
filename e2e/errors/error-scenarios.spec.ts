/**
 * E2E Tests for Error Scenarios
 *
 * Tests various error conditions and edge cases
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

// Run tests sequentially
test.describe.configure({ mode: 'serial' });

test.describe('Resource Not Found Errors', () => {
  let authToken: string;
  let apiKeyId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `error-test-key-${TEST_RUN_ID}`,
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

  test('GET non-existent server returns 404', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers/non-existent-server-id`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(404);
    const data = await response.json();
    expect(data.code).toBe('NOT_FOUND');
  });

  test('PUT non-existent server returns 404', async ({ request }) => {
    const response = await request.put(`${API_BASE}/api/servers/non-existent-server-id`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: { name: 'updated' },
    });

    expect(response.status()).toBe(404);
  });

  test('DELETE non-existent server returns 404', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/api/servers/non-existent-server-id`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(404);
  });

  test('GET non-existent API key returns 404', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/keys/non-existent-key-id`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(404);
  });

  test('DELETE non-existent API key returns 404', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/api/keys/non-existent-key-id`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(404);
  });
});

test.describe('Validation Errors', () => {
  let authToken: string;
  let apiKeyId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `validation-test-key-${TEST_RUN_ID}`,
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

  test('Create server without name returns 400', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'STDIO',
        config: { command: 'node' },
      },
    });

    expect(response.status()).toBe(400);
  });

  test('Create server without type returns 400', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'test-server',
      },
    });

    expect(response.status()).toBe(400);
  });

  test('Create server with invalid type returns 400', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'test-server',
        type: 'INVALID_TYPE',
        config: {},
      },
    });

    expect(response.status()).toBe(400);
  });

  test('Create API key without name returns 400', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        permissions: { serverIds: null },
      },
    });

    expect(response.status()).toBe(400);
  });

  test('Invalid pagination parameters are handled', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers?page=-1&pageSize=0`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    // Should either return 400 or handle gracefully
    expect([200, 400]).toContain(response.status());
  });
});

test.describe('Duplicate Resource Errors', () => {
  let authToken: string;
  let apiKeyId: string;
  let serverName: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `duplicate-test-key-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;
    serverName = `unique-server-${TEST_RUN_ID}`;
  });

  test.afterAll(async () => {
    if (apiKeyId) {
      await fetch(`${API_BASE}/api/keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  test('Create server with duplicate name returns 400', async ({ request }) => {
    // Create first server
    const createResponse = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: serverName,
        type: 'STDIO',
        config: { command: 'node' },
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const serverData = await createResponse.json();

    // Try to create duplicate
    const duplicateResponse = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: serverName,
        type: 'STDIO',
        config: { command: 'node' },
      },
    });

    expect(duplicateResponse.status()).toBe(400);

    // Cleanup
    await request.delete(`${API_BASE}/api/servers/${serverData.id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  });
});

test.describe('Agent Unavailable Scenarios', () => {
  let authToken: string;
  let apiKeyId: string;
  let serverId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `agent-test-key-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;
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

  test('Start deployment for non-existent server returns error', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers/non-existent/start`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(404);
  });

  test('Stop deployment for non-existent server returns error', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers/non-existent/stop`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(404);
  });

  test('Get logs for non-existent server returns error', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers/non-existent/logs`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    // Either 404 or 500 depending on error handling
    expect([404, 500]).toContain(response.status());
  });
});

test.describe('MCP Protocol Errors', () => {
  let authToken: string;
  let apiKeyId: string;
  let serverId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `mcp-error-test-key-${TEST_RUN_ID}`,
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
        name: `mcp-error-server-${TEST_RUN_ID}`,
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

  test('Invalid JSON-RPC version returns error', async ({ request }) => {
    const response = await request.post(`${AGENT_BASE}/mcp/${serverId}/`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '1.0',
        id: 'test',
        method: 'test',
      },
    });

    expect(response.status()).toBe(502);
  });

  test('Missing method returns error', async ({ request }) => {
    const response = await request.post(`${AGENT_BASE}/mcp/${serverId}/`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 'test',
      },
    });

    expect(response.status()).toBe(502);
  });

  test('Missing id returns error', async ({ request }) => {
    const response = await request.post(`${AGENT_BASE}/mcp/${serverId}/`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        method: 'test',
      },
    });

    expect(response.status()).toBe(502);
  });

  test('Non-existent server returns MCP error', async ({ request }) => {
    const response = await request.post(`${AGENT_BASE}/mcp/non-existent-server-id/`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 'test',
        method: 'tools/list',
      },
    });

    // Agent returns 200 with MCP error for protocol compliance
    expect(response.status()).toBe(200);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toContain('not found');
  });
});

test.describe('Large Request Handling', () => {
  let authToken: string;
  let apiKeyId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `large-request-test-key-${TEST_RUN_ID}`,
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

  test('Handle very long server name', async ({ request }) => {
    const longName = 'a'.repeat(1000);

    const response = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: longName,
        type: 'STDIO',
        config: { command: 'node' },
      },
    });

    // Should either accept or reject gracefully
    expect([200, 201, 400, 413]).toContain(response.status());
  });

  test('Handle large config object', async ({ request }) => {
    const largeConfig = {
      command: 'node',
      env: {},
    };

    // Create large env object
    for (let i = 0; i < 1000; i++) {
      largeConfig.env[`VAR_${i}`] = `value_${i}`;
    }

    const response = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `large-config-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: largeConfig,
      },
    });

    // Should either accept or reject gracefully
    expect([200, 201, 400, 413]).toContain(response.status());

    // Cleanup if created
    if (response.ok()) {
      const data = await response.json();
      await request.delete(`${API_BASE}/api/servers/${data.id}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
    }
  });
});
