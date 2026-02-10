# Gird Phase 1 SaaS 功能扩展计划

## Context

Gird 是一个 MCP (Model Context Protocol) 服务器管理系统，当前具备基础的 API Key 认证、服务器管理、多租户支持等功能。为了构建现代化的 SaaS 平台，需要扩展用户认证、权限管理、用量计量、Webhook 等核心功能。

**当前状态：**
- 认证：仅 API Key (gird_sk_xxx) + JWT Token
- 权限：简单的 serverIds 白名单
- 多租户：Tenant 模型已存在，但功能不完整
- 前端：React Dashboard 静态页面，无实际数据获取

**目标：**
实现完整的 SaaS 第一阶段功能，支持用户注册登录、RBAC 权限控制、用量计量与配额限制、Webhook 事件系统。

---

## Phase 1: 数据库和类型扩展

### 1.1 Prisma Schema 扩展

**文件：** `prisma/schema.prisma`

添加以下模型：

```prisma
// ============================================================================
// User & Authentication
// ============================================================================

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  name          String?
  avatar        String?
  emailVerified Boolean   @default(false)
  status        UserStatus @default(ACTIVE)
  tenantId      String?
  tenant        Tenant?   @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  sessions      Session[]
  userRoles     UserRole[]
  auditLogs     AuditLog[]
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([email])
  @@index([tenantId])
}

model Session {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash    String    @unique
  refreshToken String?   @unique
  userAgent    String?
  ipAddress    String?
  expiresAt    DateTime
  lastUsedAt   DateTime  @default(now())
  createdAt    DateTime  @default(now())

  @@index([userId])
  @@index([tokenHash])
  @@index([expiresAt])
}

// ============================================================================
// RBAC
// ============================================================================

model Role {
  id          String     @id @default(cuid())
  name        String     @unique
  description String?
  isSystem    Boolean    @default(false)
  permissions Json       // RolePermission object
  userRoles   UserRole[]
  createdAt   DateTime   @default(now())
  updatedAt   DateTime   @updatedAt
}

model UserRole {
  id        String   @id @default(cuid())
  userId    String
  roleId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  role      Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([userId, roleId])
  @@index([userId])
  @@index([roleId])
}

// ============================================================================
// Usage & Quota
// ============================================================================

model UsageRecord {
  id         String    @id @default(cuid())
  tenantId   String?
  tenant     Tenant?   @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  userId     String?
  apiKeyId   String?
  metricName String    // "api_requests", "mcp_calls"
  quantity   Int       @default(1)
  timestamp  DateTime  @default(now())
  metadata   Json?

  @@index([tenantId, metricName, timestamp])
  @@index([userId, timestamp])
}

// ============================================================================
// Webhooks
// ============================================================================

model Webhook {
  id           String              @id @default(cuid())
  tenantId     String?
  tenant       Tenant?             @relation(fields: [tenantId], references: [id], onDelete: SetNull)
  url          String
  secret       String
  events       WebhookEvent[]
  isActive     Boolean             @default(true)
  lastTriggerAt DateTime?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  deliveries   WebhookDelivery[]

  @@index([tenantId])
}

model WebhookDelivery {
  id          String   @id @default(cuid())
  webhookId   String
  webhook     Webhook  @relation(fields: [webhookId], references: [id], onDelete: Cascade)
  eventType   String
  payload     Json
  statusCode  Int?
  response    String?
  deliveredAt Boolean  @default(false)
  createdAt   DateTime @default(now())

  @@index([webhookId])
  @@index([deliveredAt])
}

// ============================================================================
// Enums
// ============================================================================

enum UserStatus {
  ACTIVE
  INACTIVE
  SUSPENDED
  PENDING
}

enum WebhookEvent {
  SERVER_CREATED
  SERVER_UPDATED
  SERVER_DELETED
  SERVER_STARTED
  SERVER_STOPPED
  API_KEY_CREATED
  USER_CREATED
  USAGE_THRESHOLD_REACHED
  QUOTA_EXCEEDED
}
```

**更新 Tenant 模型，添加关联：**
```prisma
model Tenant {
  // ... 现有字段
  users         User[]
  usageRecords  UsageRecord[]
  webhooks      Webhook[]
}
```

### 1.2 类型定义扩展

**文件：** `packages/core/src/types.ts`

添加：
- `User`, `UserStatus`, `Session`
- `Role`, `RolePermission`, `UserRole`
- `UsageRecord`
- `Webhook`, `WebhookEventType`, `WebhookPayload`
- `UserJwtPayload`

### 1.3 数据库迁移

```bash
pnpm db:generate
pnpm db:push
```

创建种子数据：默认角色（ADMIN, USER, READ_ONLY）

---

## Phase 2: 认证系统

### 2.1 密码工具

**新建文件：** `packages/server/src/utils/password.ts`

```typescript
import bcrypt from 'bcrypt';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

### 2.2 认证服务

**新建文件：** `packages/server/src/services/auth.service.ts`

实现：
- `register(email, password, name?)` - 用户注册
- `login(email, password)` - 用户登录
- `createSession(userId, userAgent, ipAddress)` - 创建会话
- `logout(token)` - 登出
- `verifyEmail(token)` - 邮箱验证

### 2.3 认证路由

**新建文件：** `packages/server/src/routes/auth.ts`

端点：
- `POST /api/auth/register` - 注册
- `POST /api/auth/login` - 登录
- `POST /api/auth/logout` - 登出
- `GET /api/auth/me` - 获取当前用户
- `POST /api/auth/verify-email` - 验证邮箱

### 2.4 扩展认证中间件

**修改文件：** `apps/agent/src/auth.ts`

在现有 `validateAuth` 基础上添加：
- `validateUserSession(prisma, token, ipAddress?)` - 验证用户会话
- 更新 `authHook` 支持 API Key 和用户会话两种认证方式

### 2.5 前端认证

**新建文件：**
- `packages/dashboard/src/lib/auth.ts` - 认证状态管理
- `packages/dashboard/src/pages/auth/login.tsx` - 登录页面
- `packages/dashboard/src/pages/auth/register.tsx` - 注册页面
- `packages/dashboard/src/components/auth/login-form.tsx` - 登录表单组件
- `packages/dashboard/src/components/protected-route.tsx` - 路由保护组件

---

## Phase 3: RBAC 权限系统

### 3.1 权限定义

**类型定义：** `packages/core/src/types.ts`

```typescript
export interface RolePermission {
  servers: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean };
  apiKeys: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean };
  users: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; manageRoles?: boolean };
  tenants: { read?: boolean; update?: boolean; manageQuota?: boolean };
  webhooks: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean };
}
```

### 3.2 RBAC 中间件

**新建文件：** `packages/server/src/middleware/rbac.ts`

```typescript
export function requirePermission(options: {
  scope: 'servers' | 'apiKeys' | 'users' | 'tenants' | 'webhooks';
  action: 'create' | 'read' | 'update' | 'delete' | 'manage';
}) {
  return async (request, reply) => {
    // 检查用户角色的权限
    // 无权限抛出 AuthorizationError
  };
}
```

### 3.3 角色和用户管理路由

**新建文件：**
- `packages/server/src/routes/roles.ts` - `GET/POST/PUT/DELETE /api/roles`
- `packages/server/src/routes/users.ts` - `GET/POST/PUT/DELETE /api/users`
- `packages/server/src/services/role.service.ts` - 角色服务
- `packages/server/src/services/user.service.ts` - 用户服务

### 3.4 前端用户管理页面

**新建文件：**
- `packages/dashboard/src/pages/users/index.tsx` - 用户列表
- `packages/dashboard/src/pages/roles/index.tsx` - 角色列表

---

## Phase 4: 用量计量与配额

### 4.1 用量服务

**新建文件：** `packages/server/src/services/usage.service.ts`

实现：
- `recordUsage(data)` - 记录用量
- `getUsageSummary(tenantId, period)` - 获取用量汇总
- `getUsageTimeseries(tenantId, metricName, days)` - 获取时序数据

### 4.2 用量记录中间件

**新建文件：** `packages/server/src/middleware/usage.ts`

在每个 API 请求后自动记录用量。

### 4.3 配额检查中间件

**新建文件：** `packages/server/src/middleware/quota.ts`

在创建资源前检查配额：
- `checkQuota({ resource: 'servers', operation: 'create' })`
- 超限时返回 429 错误

### 4.4 用量统计路由

**新建文件：** `packages/server/src/routes/usage.ts`

端点：
- `GET /api/usage/summary` - 用量汇总
- `GET /api/usage/timeseries` - 时序数据

### 4.5 前端用量页面

**新建文件：** `packages/dashboard/src/pages/settings/usage.tsx`

---

## Phase 5: Webhook 系统

### 5.1 Webhook 服务

**新建文件：** `packages/server/src/services/webhook.service.ts`

实现：
- `createWebhook(data)` - 创建 webhook
- `triggerEvent(event, data, tenantId?)` - 触发事件
- `deliverWebhook(webhook, delivery)` - 投递 webhook
- `generateSignature(secret, payload)` - HMAC 签名

### 5.2 Webhook 路由

**新建文件：** `packages/server/src/routes/webhooks.ts`

端点：
- `GET/POST /api/webhooks` - 列表/创建
- `GET/PUT/DELETE /api/webhooks/:id` - 详情/更新/删除
- `POST /api/webhooks/:id/test` - 测试 webhook
- `GET /api/webhooks/:id/deliveries` - 投递历史

### 5.3 前端 Webhook 页面

**新建文件：**
- `packages/dashboard/src/pages/webhooks/index.tsx`

---

## Phase 6: OpenAPI 文档与速率限制

### 6.1 OpenAPI 文档

**修改文件：** `packages/server/src/index.ts`

添加依赖：
```bash
pnpm add @fastify/swagger @fastify/swagger-ui
```

注册插件：
```typescript
await fastify.register(swagger, {
  openapi: { info: { title: 'Gird API', version: '1.0.0' } },
});
await fastify.register(swaggerUi, { routePrefix: '/docs' });
```

为每个路由添加 schema 定义。

### 6.2 速率限制

**新建文件：** `packages/server/src/middleware/rate-limit.ts`

使用 `@fastify/rate-limit`：
```typescript
export default fp(async function (fastify) {
  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.tenantId || request.userId || request.ip,
  });
});
```

---

## Phase 7: CLI 扩展

**新建文件：**
- `packages/cli/src/commands/auth.ts` - `gird auth register/login/logout`
- `packages/cli/src/commands/user.ts` - `gird user list/create/delete`
- `packages/cli/src/commands/usage.ts` - `gird usage summary`

**修改文件：** `packages/cli/src/index.ts` - 注册新命令

---

## Phase 8: 前端 Dashboard 完善

### 8.1 布局组件

**新建文件：**
- `packages/dashboard/src/components/layout/header.tsx` - 导航栏（含用户菜单）
- `packages/dashboard/src/components/layout/sidebar.tsx` - 侧边栏

### 8.2 更新路由

**修改文件：** `packages/dashboard/src/App.tsx`

添加：
- 认证状态检查
- 受保护路由包装
- 新页面路由（users, roles, webhooks, settings/usage）

---

## 关键文件清单

### 需要创建的文件

| 文件 | 用途 |
|------|------|
| `packages/server/src/utils/password.ts` | 密码哈希工具 |
| `packages/server/src/utils/session.ts` | 会话管理 |
| `packages/server/src/services/auth.service.ts` | 认证服务 |
| `packages/server/src/services/user.service.ts` | 用户服务 |
| `packages/server/src/services/role.service.ts` | 角色服务 |
| `packages/server/src/services/usage.service.ts` | 用量服务 |
| `packages/server/src/services/webhook.service.ts` | Webhook 服务 |
| `packages/server/src/middleware/rbac.ts` | RBAC 权限检查 |
| `packages/server/src/middleware/quota.ts` | 配额检查 |
| `packages/server/src/middleware/usage.ts` | 用量记录 |
| `packages/server/src/middleware/rate-limit.ts` | 速率限制 |
| `packages/server/src/routes/auth.ts` | 认证路由 |
| `packages/server/src/routes/users.ts` | 用户管理路由 |
| `packages/server/src/routes/roles.ts` | 角色管理路由 |
| `packages/server/src/routes/usage.ts` | 用量统计路由 |
| `packages/server/src/routes/webhooks.ts` | Webhook 管理路由 |
| `packages/dashboard/src/lib/auth.ts` | 前端认证管理 |
| `packages/dashboard/src/lib/api.ts` | API 客户端 |
| `packages/dashboard/src/components/protected-route.tsx` | 路由保护 |
| `packages/dashboard/src/components/auth/login-form.tsx` | 登录表单 |
| `packages/dashboard/src/pages/auth/login.tsx` | 登录页面 |
| `packages/dashboard/src/pages/users/index.tsx` | 用户列表 |
| `packages/dashboard/src/pages/settings/usage.tsx` | 用量统计 |
| `packages/cli/src/commands/auth.ts` | CLI 认证命令 |
| `packages/cli/src/commands/user.ts` | CLI 用户命令 |

### 需要修改的文件

| 文件 | 修改内容 |
|------|---------|
| `prisma/schema.prisma` | 添加 User, Role, Session, UsageRecord, Webhook 模型 |
| `packages/core/src/types.ts` | 添加新类型定义 |
| `packages/core/src/index.ts` | 导出新类型 |
| `apps/agent/src/auth.ts` | 扩展支持用户会话验证 |
| `packages/server/src/index.ts` | 注册新路由和中间件 |
| `packages/server/src/schemas.ts` | 添加新的 Zod 验证 schema |
| `packages/dashboard/src/App.tsx` | 添加新路由和认证提供者 |
| `packages/cli/src/index.ts` | 注册新命令 |

### 需要添加的依赖

```bash
# packages/server
pnpm add @fastify/swagger @fastify/swagger-ui @fastify/rate-limit

# packages/dashboard
pnpm add recharts react-hook-form @hookform/resolvers
```

---

## 实施顺序

1. **数据库扩展** - 更新 Prisma schema，运行迁移
2. **类型定义** - 更新 `packages/core/src/types.ts`
3. **认证系统** - 密码工具、认证服务、认证路由
4. **前端认证** - 登录/注册页面、API 客户端
5. **RBAC 系统** - 权限中间件、角色/用户管理
6. **用量计量** - 用量服务、配额中间件
7. **Webhook 系统** - Webhook 服务和路由
8. **OpenAPI 和限流** - 文档生成、速率限制
9. **CLI 扩展** - 新增命令
10. **前端完善** - 布局组件、所有新页面

---

## 验证步骤

1. 数据库迁移成功：`pnpm db:push` 无错误
2. 注册新用户并登录成功
3. 创建角色并分配给用户
4. 权限检查生效（无权限用户无法访问资源）
5. API 请求被正确记录到 UsageRecord
6. 超过配额时返回 429 错误
7. Webhook 事件成功触发和投递
8. 访问 `/docs` 查看 OpenAPI 文档
9. 速率限制生效
10. CLI 新命令可正常工作

---

## 第二阶段（简要记录）

**目标：** OAuth/SSO、团队协作、订阅计费

| 功能 | 说明 |
|------|------|
| OAuth 2.0 | Google, GitHub 登录集成（使用 `passport` 策略） |
| 团队管理 | Team 模型，成员邀请，角色分配 |
| 订阅计费 | Plan/Subscription/Invoice 模型，Stripe 集成 |

---

## 第三阶段（简要记录）

**目标：** 企业级功能、高可用性

| 功能 | 说明 |
|------|------|
| SAML 2.0 | 企业级单点登录 |
| Redis 缓存 | 会话存储、速率限制 |
| 分布式追踪 | OpenTelemetry 集成 |
| 数据加密 | 敏感字段 KMS 加密 |
| 合规性 | SOC 2 准备，数据保留策略 |
