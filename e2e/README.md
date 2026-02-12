# E2E Tests

This directory contains end-to-end tests for the Gird project using Playwright.

## Running Tests

Before running tests, ensure:
1. The API server is running on port 3000 (or set `API_BASE_URL`)
2. The Agent server is running on port 3001 (or set `AGENT_BASE_URL`)
3. You have a test API key (or set `TEST_API_KEY`)

```bash
# Run all E2E tests
pnpm test:e2e

# Run tests in headed mode (useful for debugging)
pnpm test:e2e:headed

# Run tests with UI
pnpm test:e2e:ui

# Install Playwright browsers
npx playwright install
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_BASE_URL` | Base URL for API tests | `http://localhost:3000` |
| `AGENT_BASE_URL` | Base URL for Agent proxy tests | `http://localhost:3001` |
| `TEST_API_KEY` | API key for authenticated requests | (will try to create one) |

## Test Structure

```
e2e/
├── api/
│   └── servers.spec.ts    # API server CRUD tests
├── mcp/
│   └── proxy.spec.ts      # MCP proxy tests using real MCP server
└── README.md
```

## MCP Proxy Tests

The `e2e/mcp/proxy.spec.ts` file contains E2E tests for the MCP proxy functionality using a real MCP server (`@modelcontextprotocol/server-everything`). These tests verify:

- MCP protocol compliance (initialize, tools, resources, prompts)
- Authentication and authorization
- Error handling
- Sequential request handling

Requirements for MCP tests:
- `npx` must be available (used to run `@modelcontextprotocol/server-everything`)
- Internet connection (first run will download the MCP server package)

## Authentication

Tests require an API key. Either:
1. Set `TEST_API_KEY` environment variable with a valid key
2. Tests will attempt to create a key if the server allows it
