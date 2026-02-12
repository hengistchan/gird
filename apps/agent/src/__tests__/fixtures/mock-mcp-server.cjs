#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-undef, no-unused-vars */
/**
 * Mock MCP Server for STDIO Proxy Integration Tests
 *
 * This script simulates an MCP server that communicates over stdio.
 * It reads JSON-RPC messages from stdin and writes responses to stdout.
 *
 * Supported methods:
 * - initialize: Returns proper MCP initialize response
 * - tools/list: Returns a mock list of tools
 * - tools/call: Echoes the tool name and arguments
 * - ping: Returns pong
 * - Other methods: Echoes the request
 */

const readline = require('readline');

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = {
  name: 'mock-mcp-server',
  version: '1.0.0',
};

const MOCK_TOOLS = [
  {
    name: 'echo',
    description: 'Echoes back the input message',
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to echo',
        },
      },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Adds two numbers together',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
      },
      required: ['a', 'b'],
    },
  },
];

// Handle initialize request
function handleInitialize(params) {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {},
    },
    serverInfo: SERVER_INFO,
  };
}

// Handle tools/list request
function handleToolsList() {
  return {
    tools: MOCK_TOOLS,
  };
}

// Handle tools/call request
function handleToolsCall(params) {
  const name = params?.name;
  const args = params?.arguments;

  if (name === 'echo') {
    return {
      content: [
        {
          type: 'text',
          text: args?.message ?? 'No message provided',
        },
      ],
    };
  }

  if (name === 'add') {
    const a = args?.a ?? 0;
    const b = args?.b ?? 0;
    return {
      content: [
        {
          type: 'text',
          text: String(a + b),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${name}`,
      },
    ],
    isError: true,
  };
}

// Handle ping request
function handlePing() {
  return {};
}

// Handle other requests by echoing
function handleEcho(method, params) {
  return {
    method,
    params,
    echoed: true,
  };
}

// Process a single JSON-RPC request
function processRequest(line) {
  let request;

  try {
    request = JSON.parse(line);
  } catch (error) {
    // Invalid JSON
    const response = {
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error',
      },
    };
    console.log(JSON.stringify(response));
    return;
  }

  // Validate JSON-RPC structure
  if (request.jsonrpc !== '2.0') {
    const response = {
      jsonrpc: '2.0',
      id: request.id ?? null,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc must be "2.0"',
      },
    };
    console.log(JSON.stringify(response));
    return;
  }

  // Handle notifications (no id)
  if (request.id === undefined) {
    // Just acknowledge silently
    return;
  }

  const id = request.id;
  const method = request.method;
  const params = request.params;

  let result;
  let error = null;

  try {
    switch (method) {
      case 'initialize':
        result = handleInitialize(params);
        break;
      case 'tools/list':
        result = handleToolsList();
        break;
      case 'tools/call':
        result = handleToolsCall(params);
        break;
      case 'ping':
        result = handlePing();
        break;
      default:
        // Echo for unknown methods
        result = handleEcho(method, params);
    }
  } catch (err) {
    error = {
      code: -32603,
      message: err instanceof Error ? err.message : 'Internal error',
    };
  }

  const response = {
    jsonrpc: '2.0',
    id,
  };

  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }

  console.log(JSON.stringify(response));
}

// Main: read from stdin line by line
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed) {
    processRequest(trimmed);
  }
});

// Handle stdin close
rl.on('close', () => {
  process.exit(0);
});
