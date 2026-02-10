# Gird - MCP Server Manager

A unified management system for deploying and managing MCP (Model Context Protocol) servers with API key authentication, access control, multi-tenancy support, and multiple deployment options.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-purple)](LICENSE)

**[中文文档](README.zh-CN.md)** | English

## Features

### Core Capabilities
- **Unified API Gateway**: Single entry point for all MCP servers with Bearer token authentication
- **API Key Management**: Create and manage API keys with:
  - Bcrypt-based secure hashing
  - Server-specific permissions
  - IP whitelist support
  - Expiration dates
- **Multiple Deployment Methods**:
  - Local process management (with auto-restart)
  - Docker Compose support
  - Health checking with automatic recovery
- **Multi-Tenancy**: Tenant isolation with quota management
- **Real-time Events**: SSE-based event streaming for deployment status

### Management Interfaces
- **HTTP REST API**: Full CRUD operations for servers and API keys
- **Command-line Interface (CLI)**: `gird` command for server and key management
- **Web Dashboard**: React-based UI with:
  - Server management and monitoring
  - API key administration
  - Real-time log viewing
  - Protected authentication

### Architecture Highlights
- **Service Layer**: Clean separation of business logic from HTTP handling
- **Standardized API Responses**: Consistent `{ data, success }` format
- **Pagination**: Built-in pagination, filtering, and sorting
- **Request Logging**: Comprehensive request/response logging with correlation IDs
- **Timeout Handling**: All external requests have configurable timeouts
- **Connection Limits**: SSE connection limits to prevent resource exhaustion

## Project Structure

```
gird/
├── packages/
│   ├── core/          # Shared types, utilities, logger, config, env validation
│   ├── server/        # HTTP REST API server with service layer
│   ├── cli/           # Command-line interface
│   └── dashboard/     # Web dashboard (React + Vite + TanStack Query)
├── apps/
│   └── agent/         # MCP proxy server with auth and deployment management
├── prisma/
│   ├── schema.prisma  # Database schema (User, Role, Server, ApiKey, Webhook, etc.)
│   └── seed.ts        # Default roles seed data
├── .claude/
│   └── plans/         # Implementation plans
└── package.json       # Monorepo root
```

## Getting Started

### Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker (optional, for Docker Compose deployments)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd gird

# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Push database schema
pnpm db:push

# Seed default roles (ADMIN, USER, READ_ONLY)
pnpm db:seed

# Set up environment variables
cp .env.example .env
# Edit .env with your settings (API_KEY_SECRET must be 32+ chars)
```

### Development

```bash
# Start all services in development mode
pnpm dev

# Or start individually:

# API server (port 3000)
cd packages/server && pnpm dev

# Agent proxy server (port 3001)
cd apps/agent && pnpm dev

# Web Dashboard (port 5173)
cd packages/dashboard && pnpm dev
```

### Building

```bash
# Build all packages
pnpm build

# Typecheck all packages
pnpm -r typecheck

# Lint all packages
pnpm lint
```

## Usage

### CLI Commands

```bash
# Link CLI globally (first time only)
cd packages/cli && pnpm link --global

# Server management
gird server list                    # List all servers
gird server create my-server        # Create a new server
gird server start my-server         # Start a server
gird server stop my-server          # Stop a server
gird server delete my-server -f     # Delete a server (with --force flag)

# API Key management
gird key list                       # List all API keys
gird key create my-key              # Create a new API key
gird key create my-key --servers all  # Create key with access to all servers
gird key delete my-key -f           # Delete an API key (with --force flag)
```

### HTTP API

The API server runs on `http://localhost:3000` by default.

**Authentication**: All endpoints require `Authorization: Bearer gird_sk_XXX` header.

#### Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers` | List servers (paginated, supports filtering) |
| POST | `/api/servers` | Create a new server |
| GET | `/api/servers/:id` | Get server details |
| PUT | `/api/servers/:id` | Update a server |
| DELETE | `/api/servers/:id` | Delete a server |
| POST | `/api/servers/:id/start` | Start server deployment |
| POST | `/api/servers/:id/stop` | Stop server deployment |
| GET | `/api/servers/:id/logs` | Get server logs |

**Query Parameters** (for list endpoints):
- `page` (default: 1)
- `pageSize` (default: 20, max: 100)
- `type` (STDIO, SSE, AWS_LAMBDA, EXECUTABLE)
- `status` (ACTIVE, STOPPED, ERROR)
- `search` (search in name/description)
- `sortBy` (name, createdAt, updatedAt)
- `sortOrder` (asc, desc)

#### API Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/keys` | List API keys (paginated) |
| POST | `/api/keys` | Create a new API key |
| GET | `/api/keys/:id` | Get API key details |
| DELETE | `/api/keys/:id` | Delete an API key |

**Response Format:**
```json
{
  "data": { ... },
  "success": true
}
```

### Agent Proxy

The Agent proxy server runs on `http://localhost:3001` by default.

**Endpoints:**
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics
- `GET /events` - SSE event stream (authenticated)
- `ALL /mcp/:serverId/*` - MCP proxy to backend servers (authenticated)

**Example MCP Request:**
```bash
curl -X POST http://localhost:3001/mcp/YOUR_SERVER_ID/tools/list \
  -H "Authorization: Bearer gird_sk_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Web Dashboard

Open `http://localhost:5173` in your browser to access the web dashboard.

**Features:**
- **Dashboard Overview**: Quick stats and navigation
- **Servers Page**: List, create, view details, start/stop servers
- **Server Details**: Full server info, deployment controls, live logs
- **API Keys Page**: List, create, delete API keys
- **Authentication**: API key-based login

## Configuration

Configuration is managed through environment variables (`.env` file):

```env
# Database (SQLite default, can use PostgreSQL)
DATABASE_URL="file:./dev.db"

# Agent Server (Proxy)
AGENT_PORT=3001
AGENT_HOST=127.0.0.1

# API Server
API_PORT=3000
API_HOST=0.0.0.0

# Dashboard
DASHBOARD_PORT=5173

# Secret for API key hashing (MUST be 32+ characters in production)
API_KEY_SECRET="change-this-to-a-secure-random-string-min-32-chars-long"

# Environment
NODE_ENV="development"
```

### Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./dev.db` | Database connection string |
| `API_KEY_SECRET` | *required* | Secret for API key hashing (min 32 chars) |
| `AGENT_HOST` | `127.0.0.1` | Agent server bind address |
| `AGENT_PORT` | `3001` | Agent server port |
| `API_HOST` | `0.0.0.0` | API server bind address |
| `API_PORT` | `3000` | API server port |
| `DASHBOARD_PORT` | `5173` | Dashboard port |
| `NODE_ENV` | `development` | Environment (development/production/test) |

## Database Schema

The project uses Prisma with SQLite (by default, PostgreSQL compatible).

### Core Models
- **User**: User accounts with email/password authentication
- **Session**: User sessions for web dashboard
- **Role**: RBAC roles with JSON permissions
- **UserRole**: User-role associations
- **Tenant**: Multi-tenant isolation
- **Server**: MCP server configurations (STDIO, SSE, AWS_LAMBDA, EXECUTABLE)
- **Deployment**: Deployment records with status tracking
- **ApiKey**: API keys with permissions and IP whitelist
- **UsageRecord**: Usage tracking for billing/quotas
- **Webhook**: Webhook configurations for event notifications
- **HealthCheck**: Health check records for deployments
- **Metric**: Prometheus metrics storage
- **AuditLog**: Operation audit trail

## Development

### Type Safety

The project is written in TypeScript with strict mode enabled.

```bash
# Typecheck all packages
pnpm -r typecheck
```

### Code Organization

- **Service Layer**: Business logic in `packages/server/src/services/`
- **Middleware**: Authentication, logging in `packages/server/src/middleware/`
- **Type Guards**: Safe type narrowing in `packages/core/src/type-guards.ts`
- **React Hooks**: TanStack Query hooks in `packages/dashboard/src/hooks/`

### Adding New Features

1. **Add database model**: Update `prisma/schema.prisma`
2. **Run migrations**: `pnpm db:generate && pnpm db:push`
3. **Add types**: Update `packages/core/src/types.ts`
4. **Add service**: Create in `packages/server/src/services/`
5. **Add routes**: Create in `packages/server/src/routes/`
6. **Update dashboard**: Add hooks and pages

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines and code of conduct.
