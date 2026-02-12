/**
 * E2E Tests for API Key Authentication Flow
 *
 * Tests the complete auth flow: Create key -> Use key -> Verify permissions -> Delete key
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

test.describe('API Key Authentication E2E Tests', () => {
  let masterKey: string;
  let masterKeyId: string;
  let testKeyId: string;
  let testKeyValue: string;

  test.beforeAll(async () => {
    // Create master API key
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `auth-test-master-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    masterKey = data.key;
    masterKeyId = data.id;
  });

  test.afterAll(async () => {
    // Cleanup
    if (masterKeyId) {
      await fetch(`${API_BASE}/api/keys/${masterKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${masterKey}` },
      }).catch(() => {});
    }
  });

  test('Create API key with full access', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `full-access-key-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.key).toMatch(/^gird_sk_/);
    expect(data.permissions.serverIds).toBeNull();

    testKeyId = data.id;
    testKeyValue = data.key;
  });

  test('Use created key to access API', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${testKeyValue}`,
      },
    });

    expect(response.ok()).toBeTruthy();
  });

  test('Created key should appear in list', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${masterKey}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    const found = data.data.find((k: any) => k.id === testKeyId);
    expect(found).toBeDefined();
  });

  test('Delete the test key', async ({ request }) => {
    const response = await request.delete(`${API_BASE}/api/keys/${testKeyId}`, {
      headers: {
        Authorization: `Bearer ${masterKey}`,
      },
    });

    expect(response.ok()).toBeTruthy();
  });

  test('Deleted key should not work', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${testKeyValue}`,
      },
    });

    expect(response.status()).toBe(401);
  });
});

test.describe('Restricted Access API Key Tests', () => {
  let masterKey: string;
  let masterKeyId: string;
  let restrictedKeyId: string;
  let restrictedKeyValue: string;
  let allowedServerId: string;
  let deniedServerId: string;

  test.beforeAll(async () => {
    // Create master key
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `restricted-test-master-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    masterKey = data.key;
    masterKeyId = data.id;

    // Create two servers
    const server1Response = await fetch(`${API_BASE}/api/servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `allowed-server-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: { command: 'node', args: ['--version'] },
      }),
    });
    const server1Data = await server1Response.json();
    allowedServerId = server1Data.id;

    const server2Response = await fetch(`${API_BASE}/api/servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `denied-server-${TEST_RUN_ID}`,
        type: 'STDIO',
        config: { command: 'node', args: ['--version'] },
      }),
    });
    const server2Data = await server2Response.json();
    deniedServerId = server2Data.id;
  });

  test.afterAll(async () => {
    // Cleanup
    if (allowedServerId) {
      await fetch(`${API_BASE}/api/servers/${allowedServerId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${masterKey}` },
      }).catch(() => {});
    }
    if (deniedServerId) {
      await fetch(`${API_BASE}/api/servers/${deniedServerId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${masterKey}` },
      }).catch(() => {});
    }
    if (restrictedKeyId) {
      await fetch(`${API_BASE}/api/keys/${restrictedKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${masterKey}` },
      }).catch(() => {});
    }
    if (masterKeyId) {
      await fetch(`${API_BASE}/api/keys/${masterKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${masterKey}` },
      }).catch(() => {});
    }
  });

  test('Create restricted access key', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${masterKey}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: `restricted-key-${TEST_RUN_ID}`,
        permissions: { serverIds: [allowedServerId] },
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.permissions.serverIds).toEqual([allowedServerId]);

    restrictedKeyId = data.id;
    restrictedKeyValue = data.key;
  });

  test('Restricted key can access allowed server', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers/${allowedServerId}`, {
      headers: {
        Authorization: `Bearer ${restrictedKeyValue}`,
      },
    });

    expect(response.ok()).toBeTruthy();
  });

  test('Restricted key cannot access denied server via MCP', async ({ request }) => {
    const response = await request.post(`${AGENT_BASE}/mcp/${deniedServerId}/`, {
      headers: {
        Authorization: `Bearer ${restrictedKeyValue}`,
        'Content-Type': 'application/json',
      },
      data: {
        jsonrpc: '2.0',
        id: 'restricted-test',
        method: 'tools/list',
      },
    });

    expect(response.status()).toBe(403);
  });
});

test.describe('Invalid Authentication Tests', () => {
  test('Missing Authorization header returns 401', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`);
    expect(response.status()).toBe(401);
  });

  test('Invalid API key format returns 401', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: 'Bearer invalid-key',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('Non-existent API key returns 401', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: 'Bearer gird_sk_nonexistentkey12345678',
      },
    });
    expect(response.status()).toBe(401);
  });

  test('Wrong auth scheme returns 401', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: 'Basic some-credentials',
      },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('API Key Search and Pagination', () => {
  let masterKey: string;
  let masterKeyId: string;
  let createdKeyIds: string[] = [];

  test.beforeAll(async () => {
    const createResponse = await fetch(`${API_BASE}/api/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `search-test-master-${TEST_RUN_ID}`,
        permissions: { serverIds: null },
      }),
    });

    const data: ApiKeyResponse = await createResponse.json();
    masterKey = data.key;
    masterKeyId = data.id;

    // Create multiple keys with searchable names
    for (let i = 0; i < 3; i++) {
      const keyResponse = await fetch(`${API_BASE}/api/keys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${masterKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `searchable-key-${TEST_RUN_ID}-${i}`,
          permissions: { serverIds: null },
        }),
      });
      const keyData = await keyResponse.json();
      createdKeyIds.push(keyData.id);
    }
  });

  test.afterAll(async () => {
    for (const id of createdKeyIds) {
      await fetch(`${API_BASE}/api/keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${masterKey}` },
      }).catch(() => {});
    }
    if (masterKeyId) {
      await fetch(`${API_BASE}/api/keys/${masterKeyId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${masterKey}` },
      }).catch(() => {});
    }
  });

  test('Search keys by name', async ({ request }) => {
    const response = await request.get(
      `${API_BASE}/api/keys?search=searchable-key-${TEST_RUN_ID}`,
      {
        headers: {
          Authorization: `Bearer ${masterKey}`,
        },
      }
    );

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.data.length).toBe(3);
  });

  test('Paginate keys', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/keys?page=1&pageSize=2`, {
      headers: {
        Authorization: `Bearer ${masterKey}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.data.length).toBe(2);
    expect(data.meta.page).toBe(1);
    expect(data.meta.pageSize).toBe(2);
  });
});
