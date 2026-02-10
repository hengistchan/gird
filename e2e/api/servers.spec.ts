import { test, expect } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';

// Get or create test API key
async function getTestApiKey() {
  const testKey = process.env.TEST_API_KEY;
  if (testKey) return testKey;

  // If no test key provided, we'll try to create one
  // This assumes the server allows key creation without auth (for testing only)
  const createResponse = await fetch(`${API_BASE}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-test-key',
      description: 'Auto-generated test key for E2E tests',
      serverIds: null, // Full access
    }),
  });

  if (createResponse.ok) {
    const data = await createResponse.json();
    return data.key;
  }

  throw new Error(
    'No TEST_API_KEY env var set and could not create test key. ' +
      'Either set TEST_API_KEY or ensure the server allows key creation.'
  );
}

test.describe('API: Servers CRUD', () => {
  let authToken: string;
  let serverId: string;

  test.beforeAll(async () => {
    authToken = await getTestApiKey();
  });

  test('POST /api/servers - Create a new server', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'e2e-test-server',
        description: 'Test server for E2E tests',
        type: 'STDIO',
        config: {
          command: 'node',
          args: ['--version'],
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toMatchObject({
      name: 'e2e-test-server',
      description: 'Test server for E2E tests',
      type: 'STDIO',
    });
    expect(data.id).toBeDefined();
    expect(data.config).toMatchObject({
      command: 'node',
      args: ['--version'],
    });

    serverId = data.id;
  });

  test('GET /api/servers - List all servers', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
    expect(data.length).toBeGreaterThan(0);

    // Find our test server
    const testServer = data.find((s: any) => s.name === 'e2e-test-server');
    expect(testServer).toBeDefined();
  });

  test('GET /api/servers/:id - Get server by ID', async ({ request }) => {
    // First, get the list to find our server ID
    const listResponse = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const servers = await listResponse.json();
    const testServer = servers.find((s: any) => s.name === 'e2e-test-server');
    expect(testServer).toBeDefined();
    serverId = testServer.id;

    const response = await request.get(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toMatchObject({
      id: serverId,
      name: 'e2e-test-server',
      type: 'STDIO',
    });
  });

  test('PUT /api/servers/:id - Update a server', async ({ request }) => {
    // Get the server ID first
    const listResponse = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const servers = await listResponse.json();
    const testServer = servers.find((s: any) => s.name === 'e2e-test-server');
    serverId = testServer.id;

    const response = await request.put(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'e2e-test-server-updated',
        description: 'Updated test server description',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toMatchObject({
      id: serverId,
      name: 'e2e-test-server-updated',
      description: 'Updated test server description',
    });
  });

  test('DELETE /api/servers/:id - Delete a server', async ({ request }) => {
    // Get the server ID first
    const listResponse = await request.get(`${API_BASE}/api/servers`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    const servers = await listResponse.json();
    const testServer = servers.find((s: any) => s.name === 'e2e-test-server-updated');
    serverId = testServer.id;

    const response = await request.delete(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();

    // Verify the server is deleted
    const getResponse = await request.get(`${API_BASE}/api/servers/${serverId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(getResponse.status()).toBe(404);
  });

  test('GET /api/servers - Return 401 without auth', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/servers`);
    expect(response.status()).toBe(401);
  });
});

test.describe('API: API Keys CRUD', () => {
  let authToken: string;
  let keyId: string;

  test.beforeAll(async () => {
    authToken = await getTestApiKey();
  });

  test('GET /api/keys - List all API keys', async ({ request }) => {
    const response = await request.get(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('POST /api/keys - Create a new API key', async ({ request }) => {
    const response = await request.post(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'test-temp-key',
        description: 'Temporary test key',
      },
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data).toMatchObject({
      name: 'test-temp-key',
      description: 'Temporary test key',
    });
    expect(data.key).toBeDefined();
    expect(data.key).toMatch(/^gird_sk_/);
    expect(data.id).toBeDefined();

    keyId = data.id;
  });

  test('DELETE /api/keys/:id - Delete an API key', async ({ request }) => {
    // First create a key to delete
    const createResponse = await request.post(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        name: 'test-key-to-delete',
        description: 'This key will be deleted',
      },
    });

    const createdKey = await createResponse.json();

    const response = await request.delete(`${API_BASE}/api/keys/${createdKey.id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.ok()).toBeTruthy();

    // Verify the key is deleted
    const getResponse = await request.get(`${API_BASE}/api/keys/${createdKey.id}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
    expect(getResponse.status()).toBe(404);
  });
});
