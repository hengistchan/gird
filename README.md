# Gird - MCP Server Manager

A unified management system for deploying and managing MCP (Model Context Protocol) servers with API key forwarding, access control, and multiple deployment options.

## Features

- **Unified API Gateway**: Single entry point for all MCP servers with Bearer token authentication
- **API Key Management**: Create and manage API keys with server-specific permissions
- **Multiple Deployment Methods**:
  - Local process management
  - Docker Compose support
- **Multiple Management Interfaces**:
  - HTTP REST API
  - Command-line interface (CLI)
  - Web Dashboard (React)
- **Access Control**: API key-based permissions for server access

## Project Structure

```
gird/
├── packages/
│   ├── core/          # Shared types, utilities, logger, config
│   ├── server/        # HTTP REST API server
│   ├── cli/           # Command-line interface
│   └── dashboard/     # Web dashboard (React + Vite)
├── apps/
│   └── agent/         # MCP proxy server with auth
├── prisma/
│   └── schema.prisma  # Database schema
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
cd /Users/hengistchan/Code/gird

# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Push database schema
pnpm db:push

# Set up environment variables
cp .env.example .env
# Edit .env with your settings
```

### Development

```bash
# Start all services in development mode
pnpm dev

# Or start individually:

# Start the API server (port 3000)
cd packages/server && pnpm dev

# Start the Agent proxy server (port 3001)
cd apps/agent && pnpm dev

# Start the Web Dashboard (port 5173)
cd packages/dashboard && pnpm dev
```

### Building

```bash
# Build all packages
pnpm build
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
gird server delete my-server -f     # Delete a server

# API Key management
gird key list                       # List all API keys
gird key create my-key              # Create a new API key
gird key create my-key --servers all  # Create key with access to all servers
gird key delete my-key -f           # Delete an API key
```

### HTTP API

The API server runs on `http://localhost:3000` by default.

#### Server Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers` | List all servers |
| POST | `/api/servers` | Create a new server |
| GET | `/api/servers/:id` | Get server details |
| PUT | `/api/servers/:id` | Update a server |
| DELETE | `/api/servers/:id` | Delete a server |
| POST | `/api/servers/:id/start` | Start server deployment |
| POST | `/api/servers/:id/stop` | Stop server deployment |
| GET | `/api/servers/:id/logs` | Get server logs |

#### API Key Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/keys` | List all API keys |
| POST | `/api/keys` | Create a new API key |
| GET | `/api/keys/:id` | Get API key details |
| DELETE | `/api/keys/:id` | Delete an API key |

### Agent Proxy

The Agent proxy server runs on `http://localhost:3001` by default.

To make requests to MCP servers through the proxy:

```bash
curl -X POST http://localhost:3001/mcp/YOUR_SERVER_ID/tools/list \
  -H "Authorization: Bearer gird_sk_YOUR_API_KEY" \
  -H "Content-Type: application/json"
```

### Web Dashboard

Open `http://localhost:5173` in your browser to access the web dashboard.

## Configuration

Configuration is managed through environment variables (`.env` file):

```env
# Database
DATABASE_URL="file:./dev.db"

# Agent Server (Proxy)
AGENT_PORT=3001
AGENT_HOST=0.0.0.0

# API Server
API_PORT=3000
API_HOST=0.0.0.0

# Dashboard
DASHBOARD_PORT=5173

# Secret for API key hashing
API_KEY_SECRET="change-this-to-a-secure-random-string-min-32-chars-long"
```

## Database Schema

The project uses Prisma with SQLite (by default). The schema includes:

- **Server**: MCP server configurations
- **Deployment**: Server deployment records
- **ApiKey**: API keys for authentication

## License

MIT
