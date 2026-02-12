import { test, expect } from '@playwright/test';

/**
 * E2E tests for MCP Proxy functionality using a real MCP server
 *
 * These tests verify the agent server can:
 * 1. Proxy requests to STDIO-based MCP servers
 * 2. Handle MCP protocol correctly (initialize, tools, resources, prompts)
 * 3. Return valid MCP-formatted responses
 *
 * Prerequisites:
 * - The API server must be running on port 3000 (or set API_BASE_URL)
 * - The Agent server must be running on port 3001 (or set AGENT_BASE_URL)
 * - npx @modelcontextprotocol/server-everything must be available (will use npx)
 * - A test API key must be available (or set TEST_API_KEY)
 */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const AGENT_BASE = process.env.AGENT_BASE_URL || 'http://localhost:3001';

// Test server configuration - using the official MCP test server
const TEST_SERVER_NAME = `e2e-mcp-test-${Date.now()}`;
const TEST_SERVER = {
  name: TEST_SERVER_NAME,
  description: 'MCP server for E2E testing using @modelcontextprotocol/server-everything',
  type: 'STDIO',
  config: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
  },
};

// MCP Protocol Version
const MCP_PROTOCOL_VERSION = '2024-11-05';

interface McpResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface ApiKeyResponse {
  id: string;
  name: string;
  key: string;
  permissions: {
    serverIds?: string[] | null;
  };
}

interface ServerResponse {
  id: string;
  name: string;
  type: string;
  status: string;
  description: string | null;
  config: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  };
}

interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

// Store for test data - using module-level variables
let testApiKey = process.env.TEST_API_KEY || '';
let testApiKeyId = '';
let testServerId = '';

/**
 * Get or create a test API key
 */
async function getOrCreateTestApiKey(): Promise<{ key: string; id: string }> {
  const testKey = process.env.TEST_API_KEY;
  if (testKey) {
    // If we have a pre-existing key, we need to get its ID
    // Try to list keys and find it
    const listResponse = await fetch(`${API_BASE}/api/keys`, {
      headers: {
        Authorization: `Bearer ${testKey}`,
      },
    });

    if (listResponse.ok) {
      const keys = await listResponse.json();
      // For testing, we'll just use the provided key
      // In real scenarios, the ID would be tracked
      return { key: testKey, id: 'unknown' };
    }

    return { key: testKey, id: 'unknown' };
  }

  // Create a new test API key
  const createResponse = await fetch(`${API_BASE}/api/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'e2e-mcp-test-key',
      description: 'Auto-generated test key for MCP E2E tests',
      serverIds: null, // Full access
    }),
  });

  if (!createResponse.ok) {
    throw new Error(
      `Failed to create test API key: ${createResponse.status} ${await createResponse.text()}`
    );
  }

  const data: ApiKeyResponse = await createResponse.json();
  return { key: data.key, id: data.id };
}

/**
 * Send an MCP request through the agent proxy
 */
async function sendMcpRequest(
  serverId: string,
  method: string,
  params?: unknown,
  id: string | number = Date.now()
): Promise<McpResponse> {
  // Note: The trailing slash is required because the agent route is /mcp/:serverId/*
  const response = await fetch(`${AGENT_BASE}/mcp/${serverId}/`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${testApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MCP request failed: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * Validate MCP response format
 */
function validateMcpResponse(response: McpResponse, expectedId: string | number): void {
  expect(response.jsonrpc).toBe('2.0');
  expect(response.id).toBe(expectedId);
  // Either result or error should be present
  expect(response.result !== undefined || response.error !== undefined).toBe(true);
}

// Run tests sequentially
test.describe.configure({ mode: 'serial' });

test.describe('MCP Proxy E2E Tests', () => {
  // Setup: Create test resources before all tests
  test.beforeAll(async () => {
    // Get or create test API key
    const keyData = await getOrCreateTestApiKey();
    testApiKey = keyData.key;
    testApiKeyId = keyData.id;

    // Create the test MCP server
    const createResponse = await fetch(`${API_BASE}/api/servers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${testApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(TEST_SERVER),
    });

    if (!createResponse.ok) {
      throw new Error(
        `Failed to create test server: ${createResponse.status} ${await createResponse.text()}`
      );
    }

    const response: ApiResponse<ServerResponse> = await createResponse.json();
    testServerId = response.data.id;

    console.log(`Created test server: ${testServerId}`);
  });

  // Cleanup
  test.afterAll(async () => {
    // Clean up test resources
    if (!testApiKey) return;

    try {
      // Delete test server if it exists
      if (testServerId) {
        await fetch(`${API_BASE}/api/servers/${testServerId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${testApiKey}`,
          },
        });
        console.log(`Cleaned up test server: ${testServerId}`);
      }

      // Delete test API key if we created it (only if we have the ID)
      if (testApiKeyId && testApiKeyId !== 'unknown' && !process.env.TEST_API_KEY) {
        await fetch(`${API_BASE}/api/keys/${testApiKeyId}`, {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${testApiKey}`,
          },
        });
        console.log(`Cleaned up test API key: ${testApiKeyId}`);
      }
    } catch (error) {
      console.warn('Cleanup error (non-fatal):', error);
    }
  });

  // ============================================================================
  // Health Check Tests
  // ============================================================================

  test('Health check endpoint should be accessible', async () => {
    const response = await fetch(`${AGENT_BASE}/health`);
    expect(response.ok).toBeTruthy();

    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.timestamp).toBeDefined();
  });

  // ============================================================================
  // MCP Protocol Tests
  // ============================================================================

  test('initialize - should complete MCP handshake', async () => {
    const requestId = 'init-test-1';
    const response = await sendMcpRequest(
      testServerId,
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'gird-e2e-test',
          version: '1.0.0',
        },
      },
      requestId
    );

    validateMcpResponse(response, requestId);

    // Should have a result (not an error) for successful initialization
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as {
      protocolVersion?: string;
      capabilities?: unknown;
      serverInfo?: { name: string; version: string };
    };

    // Verify the response contains expected MCP initialization data
    expect(result.protocolVersion).toBeDefined();
    expect(result.capabilities).toBeDefined();
    expect(result.serverInfo).toBeDefined();
    expect(result.serverInfo?.name).toBeDefined();
    expect(result.serverInfo?.version).toBeDefined();
  });

  test('tools/list - should return available tools', async () => {
    const requestId = 'tools-list-1';
    const response = await sendMcpRequest(testServerId, 'tools/list', {}, requestId);

    validateMcpResponse(response, requestId);

    // Should have a result
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as { tools?: Array<{ name: string; description?: string }> };

    // Verify tools array exists and has tools
    expect(result.tools).toBeDefined();
    expect(Array.isArray(result.tools)).toBe(true);
    expect(result.tools!.length).toBeGreaterThan(0);

    // Verify tool structure
    const firstTool = result.tools![0];
    expect(firstTool.name).toBeDefined();
    expect(typeof firstTool.name).toBe('string');

    console.log(`Found ${result.tools!.length} tools: ${result.tools!.map((t) => t.name).join(', ')}`);
  });

  test('tools/call - should call echo tool if available', async () => {
    // First, get the list of tools to find the echo tool
    const listResponse = await sendMcpRequest(testServerId, 'tools/list', {}, 'tools-list-for-call');

    const listResult = listResponse.result as { tools?: Array<{ name: string }> };
    const tools = listResult.tools ?? [];

    // Find an echo or similar simple tool
    const echoTool = tools.find(
      (t) => t.name === 'echo' || t.name === 'sampleLLM' || t.name.includes('echo')
    );

    test.skip(!echoTool, 'No echo tool found, skipping tools/call test');

    const requestId = 'tools-call-1';
    const response = await sendMcpRequest(
      testServerId,
      'tools/call',
      {
        name: echoTool!.name,
        arguments: echoTool!.name === 'echo'
          ? { message: 'Hello from E2E test!' }
          : {},
      },
      requestId
    );

    validateMcpResponse(response, requestId);

    // Should have a result
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

    // Verify response structure
    expect(result.content).toBeDefined();
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.isError).toBeFalsy();

    console.log(`Tool ${echoTool!.name} returned: ${JSON.stringify(result.content)}`);
  });

  test('resources/list - should return available resources', async () => {
    const requestId = 'resources-list-1';
    const response = await sendMcpRequest(testServerId, 'resources/list', {}, requestId);

    validateMcpResponse(response, requestId);

    // Should have a result
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as {
      resources?: Array<{
        uri: string;
        name?: string;
        description?: string;
        mimeType?: string;
      }>;
    };

    // Verify resources array exists
    expect(result.resources).toBeDefined();
    expect(Array.isArray(result.resources)).toBe(true);

    if (result.resources!.length > 0) {
      const firstResource = result.resources![0];
      expect(firstResource.uri).toBeDefined();
      expect(typeof firstResource.uri).toBe('string');

      console.log(`Found ${result.resources!.length} resources: ${result.resources!.map((r) => r.uri).join(', ')}`);
    } else {
      console.log('No resources available (this is valid for some servers)');
    }
  });

  test('prompts/list - should return available prompts', async () => {
    const requestId = 'prompts-list-1';
    const response = await sendMcpRequest(testServerId, 'prompts/list', {}, requestId);

    validateMcpResponse(response, requestId);

    // Should have a result
    expect(response.error).toBeUndefined();
    expect(response.result).toBeDefined();

    const result = response.result as {
      prompts?: Array<{
        name: string;
        description?: string;
        arguments?: Array<{ name: string; required?: boolean }>;
      }>;
    };

    // Verify prompts array exists
    expect(result.prompts).toBeDefined();
    expect(Array.isArray(result.prompts)).toBe(true);

    if (result.prompts!.length > 0) {
      const firstPrompt = result.prompts![0];
      expect(firstPrompt.name).toBeDefined();
      expect(typeof firstPrompt.name).toBe('string');

      console.log(`Found ${result.prompts!.length} prompts: ${result.prompts!.map((p) => p.name).join(', ')}`);
    } else {
      console.log('No prompts available (this is valid for some servers)');
    }
  });

  test('should return MCP error for invalid method', async () => {
    const requestId = 'invalid-method-1';
    const response = await sendMcpRequest(testServerId, 'invalid/unknown/method', {}, requestId);

    validateMcpResponse(response, requestId);

    // Should have an error
    expect(response.error).toBeDefined();
    expect(response.error!.code).toBeDefined();
    expect(response.error!.message).toBeDefined();

    console.log(`Received expected error for invalid method: ${response.error!.message}`);
  });

  test('should return MCP error for malformed request', async () => {
    // Send a request without required fields
    const response = await fetch(`${AGENT_BASE}/mcp/${testServerId}/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${testApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        // Missing id and method
      }),
    });

    // The agent should either return an HTTP error or an MCP error response
    if (response.ok) {
      const data = await response.json();
      // If it returned a 200, it should be an MCP error response
      expect(data.error).toBeDefined();
    } else {
      // HTTP error is also acceptable for malformed requests
      expect(response.status).toBeGreaterThanOrEqual(400);
    }
  });

  // ============================================================================
  // Authentication Tests
  // ============================================================================

  test('should reject requests without Authorization header', async () => {
    const response = await fetch(`${AGENT_BASE}/mcp/${testServerId}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'no-auth-test',
        method: 'tools/list',
      }),
    });

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.code).toBe('AUTHENTICATION_ERROR');
  });

  test('should reject requests with invalid API key', async () => {
    const response = await fetch(`${AGENT_BASE}/mcp/${testServerId}/`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer gird_sk_invalidkey123456',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'invalid-key-test',
        method: 'tools/list',
      }),
    });

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.code).toBe('AUTHENTICATION_ERROR');
  });

  test('should reject requests for non-existent server', async () => {
    const response = await fetch(`${AGENT_BASE}/mcp/non-existent-server-id/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${testApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'non-existent-server-test',
        method: 'tools/list',
      }),
    });

    // Agent returns 200 with MCP error for protocol compliance
    // The error is in the MCP response body, not HTTP status
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toContain('not found');
  });

  // ============================================================================
  // Multiple Sequential Requests Test
  // ============================================================================

  test('should handle multiple sequential MCP requests', async () => {
    // Send a series of requests to test connection reuse and state management
    const requests = [
      { method: 'tools/list', id: 'seq-1' },
      { method: 'resources/list', id: 'seq-2' },
      { method: 'prompts/list', id: 'seq-3' },
      { method: 'tools/list', id: 'seq-4' },
    ];

    for (const req of requests) {
      const response = await sendMcpRequest(testServerId, req.method, {}, req.id);
      validateMcpResponse(response, req.id);
      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      console.log(`Sequential request ${req.id} (${req.method}) succeeded`);
    }
  });
});
