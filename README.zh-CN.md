# Gird - MCP 服务器管理系统

一个用于部署和管理 MCP (Model Context Protocol) 服务器的统一管理系统，支持 API 密钥认证、访问控制、多租户支持以及多种部署方式。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-purple)](LICENSE)

## 功能特性

### 核心能力
- **统一 API 网关**: 所有 MCP 服务器的单一入口点，支持 Bearer token 认证
- **API 密钥管理**: 创建和管理 API 密钥，支持：
  - 基于 bcrypt 的安全哈希
  - 服务器级权限控制
  - IP 白名单支持
  - 过期时间设置
- **多种部署方式**:
  - 本地进程管理（支持自动重启）
  - Docker Compose 支持
  - 健康检查与自动恢复
- **多租户支持**: 租户隔离与配额管理
- **实时事件**: 基于 SSE 的事件流，用于部署状态推送

### 管理界面
- **HTTP REST API**: 完整的服务器和 API 密钥 CRUD 操作
- **命令行工具 (CLI)**: `gird` 命令用于服务器和密钥管理
- **Web 控制台**: 基于 React 的 UI 界面，支持：
  - 服务器管理与监控
  - API 密钥管理
  - 实时日志查看
  - 认证保护

### 架构亮点
- **服务层**: 业务逻辑与 HTTP 处理分离
- **标准化 API 响应**: 统一的 `{ data, success }` 格式
- **分页支持**: 内置分页、过滤和排序功能
- **请求日志**: 完整的请求/响应日志，带关联 ID
- **超时处理**: 所有外部请求都支持可配置超时
- **连接限制**: SSE 连接限制，防止资源耗尽

## 项目结构

```
gird/
├── packages/
│   ├── core/          # 共享类型、工具、日志、配置、环境验证
│   ├── server/        # HTTP REST API 服务器与服务层
│   ├── cli/           # 命令行工具
│   └── dashboard/     # Web 控制台 (React + Vite + TanStack Query)
├── apps/
│   └── agent/         # MCP 代理服务器（认证与部署管理）
├── prisma/
│   ├── schema.prisma  # 数据库模型 (User, Role, Server, ApiKey, Webhook 等)
│   └── seed.ts        # 默认角色种子数据
├── .claude/
│   └── plans/         # 实现计划
└── package.json       # Monorepo 根目录
```

## 快速开始

### 前置要求

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Docker（可选，用于 Docker Compose 部署）

### 安装

```bash
# 克隆仓库
git clone <repo-url>
cd gird

# 安装依赖
pnpm install

# 生成 Prisma Client
pnpm db:generate

# 推送数据库 schema
pnpm db:push

# 添加默认角色（ADMIN, USER, READ_ONLY）
pnpm db:seed

# 设置环境变量
cp .env.example .env
# 编辑 .env 文件（API_KEY_SECRET 必须为 32+ 字符）
```

### 开发模式

```bash
# 以开发模式启动所有服务
pnpm dev

# 或者单独启动：

# API 服务器（端口 3000）
cd packages/server && pnpm dev

# Agent 代理服务器（端口 3001）
cd apps/agent && pnpm dev

# Web 控制台（端口 5173）
cd packages/dashboard && pnpm dev
```

### 构建

```bash
# 构建所有包
pnpm build

# 类型检查所有包
pnpm -r typecheck

# 代码检查
pnpm lint
```

## 使用指南

### CLI 命令

```bash
# 全局链接 CLI（首次使用）
cd packages/cli && pnpm link --global

# 服务器管理
gird server list                    # 列出所有服务器
gird server create my-server        # 创建新服务器
gird server start my-server         # 启动服务器
gird server stop my-server          # 停止服务器
gird server delete my-server -f     # 删除服务器（使用 --force 标志）

# API 密钥管理
gird key list                       # 列出所有 API 密钥
gird key create my-key              # 创建新 API 密钥
gird key create my-key --servers all  # 创建可访问所有服务器的密钥
gird key delete my-key -f           # 删除 API 密钥（使用 --force 标志）
```

### HTTP API

API 服务器默认运行在 `http://localhost:3000`。

**认证**: 所有端点需要 `Authorization: Bearer gird_sk_XXX` 请求头。

#### 服务器端点

| 方法 | 路径 | 描述 |
|--------|------|-------------|
| GET | `/api/servers` | 列出服务器（分页，支持过滤） |
| POST | `/api/servers` | 创建新服务器 |
| GET | `/api/servers/:id` | 获取服务器详情 |
| PUT | `/api/servers/:id` | 更新服务器 |
| DELETE | `/api/servers/:id` | 删除服务器 |
| POST | `/api/servers/:id/start` | 启动服务器部署 |
| POST | `/api/servers/:id/stop` | 停止服务器部署 |
| GET | `/api/servers/:id/logs` | 获取服务器日志 |

**查询参数**（用于列表端点）:
- `page`（默认: 1）
- `pageSize`（默认: 20，最大: 100）
- `type`（STDIO, SSE, AWS_LAMBDA, EXECUTABLE）
- `status`（ACTIVE, STOPPED, ERROR）
- `search`（在名称/描述中搜索）
- `sortBy`（name, createdAt, updatedAt）
- `sortOrder`（asc, desc）

#### API 密钥端点

| 方法 | 路径 | 描述 |
|--------|------|-------------|
| GET | `/api/keys` | 列出 API 密钥（分页） |
| POST | `/api/keys` | 创建新 API 密钥 |
| GET | `/api/keys/:id` | 获取 API 密钥详情 |
| DELETE | `/api/keys/:id` | 删除 API 密钥 |

**响应格式:**
```json
{
  "data": { ... },
  "success": true
}
```

### Agent 代理

Agent 代理服务器默认运行在 `http://localhost:3001`。

**端点:**
- `GET /health` - 健康检查
- `GET /metrics` - Prometheus 指标
- `GET /events` - SSE 事件流（需认证）
- `ALL /mcp/:serverId/*` - MCP 代理到后端服务器（需认证）

**MCP 请求示例:**
```bash
curl -X POST http://localhost:3001/mcp/YOUR_SERVER_ID/tools/list \
  -H "Authorization: Bearer gird_sk_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Web 控制台

在浏览器中打开 `http://localhost:5173` 访问 Web 控制台。

**功能:**
- **控制台概览**: 快速统计和导航
- **服务器页面**: 列出、创建、查看详情、启动/停止服务器
- **服务器详情**: 完整服务器信息、部署控制、实时日志
- **API 密钥页面**: 列出、创建、删除 API 密钥
- **认证**: 基于 API 密钥的登录

## 配置说明

配置通过环境变量（`.env` 文件）管理：

```env
# 数据库（默认 SQLite，可使用 PostgreSQL）
DATABASE_URL="file:./dev.db"

# Agent 服务器（代理）
AGENT_PORT=3001
AGENT_HOST=127.0.0.1

# API 服务器
API_PORT=3000
API_HOST=0.0.0.0

# 控制台
DASHBOARD_PORT=5173

# API 密钥哈希密钥（生产环境必须为 32+ 字符）
API_KEY_SECRET="change-this-to-a-secure-random-string-min-32-chars-long"

# 环境
NODE_ENV="development"
```

### 环境变量参考

| 变量 | 默认值 | 描述 |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./dev.db` | 数据库连接字符串 |
| `API_KEY_SECRET` | *必需* | API 密钥哈希密钥（最少 32 字符） |
| `AGENT_HOST` | `127.0.0.1` | Agent 服务器绑定地址 |
| `AGENT_PORT` | `3001` | Agent 服务器端口 |
| `API_HOST` | `0.0.0.0` | API 服务器绑定地址 |
| `API_PORT` | `3000` | API 服务器端口 |
| `DASHBOARD_PORT` | `5173` | 控制台端口 |
| `NODE_ENV` | `development` | 运行环境（development/production/test） |

## 数据库模型

项目使用 Prisma 配合 SQLite（默认，兼容 PostgreSQL）。

### 核心模型
- **User**: 用户账户，支持邮箱/密码认证
- **Session**: Web 控制台用户会话
- **Role**: RBAC 角色，使用 JSON 权限
- **UserRole**: 用户-角色关联
- **Tenant**: 多租户隔离
- **Server**: MCP 服务器配置（STDIO, SSE, AWS_LAMBDA, EXECUTABLE）
- **Deployment**: 部署记录，带状态跟踪
- **ApiKey**: API 密钥，带权限和 IP 白名单
- **UsageRecord**: 使用记录，用于计费/配额
- **Webhook**: 事件通知的 Webhook 配置
- **HealthCheck**: 部署的健康检查记录
- **Metric**: Prometheus 指标存储
- **AuditLog**: 操作审计日志

## 开发指南

### 类型安全

项目使用 TypeScript 严格模式编写。

```bash
# 检查所有包的类型
pnpm -r typecheck
```

### 代码组织

- **服务层**: 业务逻辑位于 `packages/server/src/services/`
- **中间件**: 认证、日志位于 `packages/server/src/middleware/`
- **类型守卫**: 安全类型缩窄位于 `packages/core/src/type-guards.ts`
- **React Hooks**: TanStack Query hooks 位于 `packages/dashboard/src/hooks/`

### 添加新功能

1. **添加数据库模型**: 更新 `prisma/schema.prisma`
2. **运行迁移**: `pnpm db:generate && pnpm db:push`
3. **添加类型**: 更新 `packages/core/src/types.ts`
4. **添加服务**: 在 `packages/server/src/services/` 创建
5. **添加路由**: 在 `packages/server/src/routes/` 创建
6. **更新控制台**: 添加 hooks 和页面

## 许可证

MIT

## 贡献

欢迎贡献！请阅读我们的贡献准则和行为准则。
