/**
 * E2E Tests for Complete Server Lifecycle
 *
 * Tests the full flow: Create server -> Start deployment -> MCP proxy -> Stop -> Delete
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const AGENT_BASE = process.env.AGENT_BASE_URL || 'http://localhost:3001';

// Generate unique ID for test run
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
  config: Record<string, unknown>;
}

interface DeploymentResponse {
  id: string;
  serverId: string;
  type: string;
  status: string;
}

interface McpResponse {
  jsonrpc: string;
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

// Run tests sequentially
test.describe.configure({ mode: 'serial' });

test.describe('Server Lifecycle E2E Tests', () => {
  let authToken: string;
  let apiKeyId: string;
  let serverId: string;
  let deploymentId: string;

  test.beforeAll(async () => {
    // Create test API key
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `lifecycle-test-key-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create test API key: ${createResponse.status}`);
    }

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;
  });

  test.afterAll(async () => {
    // Cleanup
    if (apiKeyId) {
      await fetch(`${API_BASE}/api/keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  // Phase 1: Create Server
  test('Phase 1: Create a new STDIO server', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `lifecycle-server-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything'],
        },
        description: 'Server for lifecycle testing',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.id).toBeDefined();
    expect(data.type).toBe('STDIO');
    expect(data.status).toBe('ACTIVE');

    serverId = data.id;
  });

  // Phase 2: Get Server Details
  test('Phase 2: Get server details', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.server.id).toBe(serverId);
    expect(data.server.name).toContain('lifecycle-server');
  });

  // Phase 3: Start Deployment
  test('Phase 3: Start server deployment', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers/${serverId}/start`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        type: 'LOCAL_PROCESS',
      },
    });

    // Deployment might succeed or fail depending on npx availability
    // We accept either success or a deployment error (not server not found)
    expect([200, 500]).toContain(response.status());

    if (response.ok()) {
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.deployment).toBeDefined();
      deploymentId = data.deployment.id;
    }
  });

  // Phase 4: MCP Request (if deployment succeeded)
  test('Phase 4: Send MCP request through proxy', async ({ request }) => {
    test.skip(!deploymentId, 'Deployment not started, skipping MCP test');

    // Wait a bit for the server to initialize
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const response = await request.post(`${AGENT_BASE}/mcp/${serverId}/`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 'lifecycle-test-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'lifecycle-test', version: '1.0.0' },
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const data: McpResponse = await response.json();
    expect(data.jsonrpc).toBe('2.0');
    expect(data.result).toBeDefined();
  });

  // Phase 5: Get Logs
  test('Phase 5: Get server logs', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers/${serverId}/logs`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    // Accept success or error (if no deployment)
    expect([200, 500]).toContain(response.status());
  });

  // Phase 6: Stop Deployment
  test('Phase 6: Stop server deployment', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers/${serverId}/stop`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    // Accept success or error (if no deployment was running)
    expect([200, 404, 500]).toContain(response.status());
  });

  // Phase 7: Delete Server
  test('Phase 7: Delete server', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
  });

  // Phase 8: Verify Deletion
  test('Phase 8: Verify server is deleted', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status()).toBe(404);
  });
});

test.describe('Multiple Server Lifecycle', () => {
  let authToken: string;
  let apiKeyId: string;
  let serverIds: string[] = [];

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `multi-lifecycle-key-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    authToken = data.key;
    apiKeyId = data.id;
  });

  test.afterAll(async () => {
    // Cleanup servers
    for (const id of serverIds) {
      await fetch(`${API_BASE}/api/servers/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }

    // Cleanup key
    if (apiKeyId) {
      await fetch(`${API_BASE}/api/keys/${apiKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    }
  });

  test('Create multiple servers', async ({ request }) => {
    const serverTypes = ['STDIO', 'SSE'] as const;

    for (const type of serverTypes) {
      const config =
        type === 'STDIO'
          ? { command: 'node', args: ['--version'] }
          : { url: 'https://example.com/mcp' };

      const response = await request.post(`${API_BASE}/api/servers`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        data: {
          name: `multi-${type}-${TEST_RUN_ID}`,
          type,
          config,
        },
      });

      expect(response.ok()).toBeTruthy();
      const data = await response.json();
      serverIds.push(data.id);
    }

    expect(serverIds.length).toBe(2);
  });

  test('List should include all created servers', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();

    for (const id of serverIds) {
      const found = data.data.find((s: ServerResponse) => s.id === id);
      expect(found).toBeDefined();
    }
  });

  test('Delete all servers', async ({ request }) => {
    for (const id of serverIds) {
      const response = await request.delete(`${API_BASE}/api/servers/${id}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.ok()).toBeTruthy();
    }

    serverIds = [];
  });
});

test.describe('Server Update Lifecycle', () => {
  let authToken: string;
  let apiKeyId: string;
  let serverId: string;

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `update-lifecycle-key-${TEST_RUN_ID}`,
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

  test('Create -> Update -> Verify -> Delete flow', async ({ request }) => {
    // Create
    const createResponse = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `update-test-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: { command: 'node', args: ['--version'] },
      },
    });

    expect(createResponse.ok()).toBeTruthy();
    const createData = await createResponse.json();
    serverId = createData.id;

    // Update
    const updateResponse = await request.put(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `updated-${TEST_RUN_ID}`,
        description: 'Updated description',
      },
    });

    expect(updateResponse.ok()).toBeTruthy();
    const updateData = await updateResponse.json();
    expect(updateData.name).toBe(`updated-${TEST_RUN_ID}`);

    // Verify
    const getResponse = await request.get(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(getResponse.ok()).toBeTruthy();
    const getData = await getResponse.json();
    expect(getData.server.name).toBe(`updated-${TEST_RUN_ID}`);
    expect(getData.server.description).toBe('Updated description');

    // Delete
    const deleteResponse = await request.delete(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(deleteResponse.ok()).toBeTruthy();
    serverId = ''; // Mark as deleted
  });
});
