# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Gird** is an MCP (Model Context Protocol) server management system - a unified API gateway for deploying, managing, and proxying MCP servers with API key authentication and access control.

### Architecture

```
┌─────────────────────────────────────────────────────┐
│  Dashboard (React/Vite) - Port 5173                 │
│  packages/dashboard/ - Web UI for management        │
├─────────────────────────────────────────────────────┤
│  API Server (Fastify) - Port 3000                   │
│  packages/server/ - REST API for servers/keys       │
├─────────────────────────────────────────────────────┤
│  Agent Server (Fastify) - Port 3001                 │
│  apps/agent/ - MCP proxy with auth & deployment     │
├─────────────────────────────────────────────────────┤
│  Core Package - Shared types, utils, errors         │
│  packages/core/ - Used by all other packages        │
├─────────────────────────────────────────────────────┤
│  CLI - Command-line tool for server/key mgmt       │
│  packages/cli/ - `gird` command                     │
└─────────────────────────────────────────────────────┘
                    ↓
        Prisma + SQLite (PostgreSQL-compatible)

```

### Key Packages

| Package | Purpose |
|---------|---------|
| `packages/core` | Shared types, errors, logger, config, JWT utilities, API key generation/hashing |
| `packages/server` | HTTP REST API for managing MCP servers and API keys |
| `packages/cli` | Command-line interface (`gird server ...`, `gird key ...`) |
| `packages/dashboard` | React web dashboard (Vite, React Router, TanStack Query) |
| `apps/agent` | MCP proxy server - handles auth, deployment, health checks, metrics, SSE events |

## Common Commands

```bash
# Install dependencies
pnpm install

# Database setup (must run after schema changes)
pnpm db:generate    # Generate Prisma Client
pnpm db:push        # Push schema to database
pnpm db:studio      # Open Prisma Studio

# Development - start all apps/*
pnpm dev

# Development - start individual services
cd packages/server && pnpm dev    # API server on :3000
cd apps/agent && pnpm dev         # Agent proxy on :3001
cd packages/dashboard && pnpm dev # Dashboard on :5173

# Build all packages
pnpm build

# Lint and typecheck
pnpm lint
pnpm -r typecheck   # Run in all packages

# Clean all build artifacts
pnpm clean
```

## Environment Variables

Copy `.env.example` to `.env`:

```env
DATABASE_URL="file:./dev.db"       # SQLite (or postgresql://...)
API_KEY_SECRET="<32+ chars>"       # Required for API key hashing
AGENT_PORT=3001
API_PORT=3000
DASHBOARD_PORT=5173
```

## Database Schema

The Prisma schema (`prisma/schema.prisma`) defines:

- **Server** - MCP server configurations (type: STDIO/SSE/AWS_LAMBDA/EXECUTABLE)
- **Deployment** - Deployment records (DOCKER_COMPOSE/LOCAL_PROCESS)
- **ApiKey** - API keys with permissions (`serverIds` array or `null` for all)
- **Tenant** - Multi-tenancy support (optional)
- **HealthCheck** - Health check records for deployments
- **Metric** - Metrics collection
- **AuditLog** - Operation audit trail

After modifying schema, always run:
```bash
pnpm db:generate
pnpm db:push
```

**Cascade behavior**: Deleting a Server cascades to its Deployments, which cascade to HealthChecks. Tenants use `SetNull` to preserve records if the tenant is deleted.

## Important Architecture Patterns

### Authentication Flow

1. **API Key Format**: `gird_sk_<base64url>` - generated in `packages/core/src/index.ts`
2. **Storage**: Key stored as plaintext, hash stored separately for verification via bcrypt
3. **Agent Auth**: `apps/agent/src/auth.ts` validates Bearer tokens, checks IP whitelist, server permissions
4. **JWT Support**: JWT tokens can be used instead of raw API keys

### Server Types and Config

Each `Server` has a `type` and corresponding `config` JSON (see `packages/core/src/types.ts`):

- **STDIO**: `{ command, args?, env?, cwd? }` - Local process with stdio
- **SSE**: `{ url, headers? }` - Remote SSE server
- **AWS_LAMBDA**: `{ functionName, region?, credentials? }` - AWS Lambda
- **EXECUTABLE**: `{ path, args?, env? }` - Executable binary

### Deployment Types

- **LOCAL_PROCESS**: `apps/agent/src/deployment/local-process.ts` - spawns child processes
- **DOCKER_COMPOSE**: `apps/agent/src/deployment/docker-compose.ts` - manages Docker containers

### Agent Server Modules

Located in `apps/agent/src/`:

- `auth.ts` - Authentication hooks (`authHook`, `optionalAuthHook`)
- `proxy.ts` - MCP request proxying to backend servers
- `deployment/` - Deployment lifecycle management
- `health/` - Health checking and auto-restart
- `metrics/` - Prometheus metrics collection
- `realtime/` - SSE events for real-time updates

### Type Imports

All shared types come from `@gird/core`:
```typescript
import type { ServerType, ServerConfig, ApiKeyPermissions, GirdError } from '@gird/core';
```

### Error Handling

All custom errors extend `GirdError` (`packages/core/src/types.ts`):
- `AuthenticationError` (401)
- `AuthorizationError` (403)
- `NotFoundError` (404)
- `ValidationError` (400)
- `DeploymentError` (500)
- `ProxyError` (502)

## Validation

Request validation uses **Zod schemas**. Schemas are defined in `packages/server/src/schemas.ts`:
- `CreateServerSchema` - Server creation validation
- `UpdateServerSchema` - Server update validation
- `IdParamsSchema` - ID parameter validation

Example usage in routes:
```typescript
import { CreateServerSchema, IdParamsSchema } from '../schemas.js';

const data = CreateServerSchema.parse(request.body);
const { id } = IdParamsSchema.parse(request.params);
```

## Monorepo Notes

- **Workspace protocol**: Use `workspace:*` in package.json for internal dependencies
- **Build order**: Core builds first (others depend on `@gird/core`)
- **pnpm filters**: `pnpm --filter './apps/*'` targets only apps/, not packages/
- **TypeScript**: All packages use `tsconfig.base.json` as base, with strict mode enabled

## CLI Global Link

To use the `gird` command globally:
```bash
cd packages/cli && pnpm link --global
```

Then use:
```bash
gird server list
gird server create <name>
gird server start <name>
gird key list
gird key create <name> --servers all
```

## Inter-Service Communication

The **API Server** (`:3000`) communicates with the **Agent Server** (`:3001`) internally for deployment operations:

- Start/Stop deployments → `POST http://agent:3001/deployments/{serverId}/start`
- Get logs → `GET http://agent:3001/deployments/{serverId}/logs`

The Agent URL is configured via `AGENT_HOST` and `AGENT_PORT` environment variables.

## API Endpoints Reference

### API Server (:3000)

**Servers:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers` | List all servers |
| POST | `/api/servers` | Create server |
| GET | `/api/servers/:id` | Get server details |
| PUT | `/api/servers/:id` | Update server |
| DELETE | `/api/servers/:id` | Delete server |
| POST | `/api/servers/:id/start` | Start deployment (proxies to Agent) |
| POST | `/api/servers/:id/stop` | Stop deployment (proxies to Agent) |
| GET | `/api/servers/:id/logs` | Get logs (proxies to Agent) |

**API Keys:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/keys` | List all keys |
| POST | `/api/keys` | Create key |
| GET | `/api/keys/:id` | Get key details |
| DELETE | `/api/keys/:id` | Delete key |

### Agent Server (:3001)

**Public endpoints (no auth):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/metrics` | Prometheus metrics |

**Authenticated endpoints (Bearer token required):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/servers` | List servers |
| GET | `/events` | SSE event stream |
| POST | `/events` | Emit event |
| GET | `/deployments/:serverId/logs` | Get deployment logs |
| GET | `/deployments/:serverId/status` | Get deployment status |
| POST | `/deployments/:serverId/start` | Start deployment |
| POST | `/deployments/:serverId/stop` | Stop deployment |
| ALL | `/mcp/:serverId/*` | MCP proxy to backend server |

## MCP Proxy Format

When proxying MCP requests through the Agent:
```bash
curl -X POST http://localhost:3001/mcp/{SERVER_ID}/tools/list \
  -H "Authorization: Bearer gird_sk_{YOUR_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The Agent validates the API key, checks server permissions, then forwards the request to the actual MCP server.
