# E2E Tests

This directory contains end-to-end tests for the Gird project using Playwright.

## Running Tests

Before running tests, ensure:
1. The API server is running on port 3000 (or set `API_BASE_URL`)
2. You have a test API key (or set `TEST_API_KEY`)

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
| `TEST_API_KEY` | API key for authenticated requests | (will try to create one) |

## Test Structure

```
e2e/
├── api/
│   └── servers.spec.ts    # API server CRUD tests
└── README.md
```

## Authentication

Tests require an API key. Either:
1. Set `TEST_API_KEY` environment variable with a valid key
2. Tests will attempt to create a key if the server allows it
