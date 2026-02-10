# Gird 技术债务修复计划

## Context

基于对 Gird 代码库的全面技术债务分析，发现存在 10 个 Critical 级别问题、16 个 High Priority 问题、14 个 Medium Priority 问题和 10 个 Low Priority 问题。

**分析范围:**
- General Codebase (packages/core, prisma)
- API Server (packages/server)
- Agent Server (apps/agent)
- Dashboard (packages/dashboard)
- CLI (packages/cli)

**当前状态:**
- 安全：API Key 哈希使用不安全的 SHA-256 无盐哈希
- 架构：API Server 无服务层，业务逻辑在路由中
- 资源管理：多个 PrismaClient 单例导致连接泄漏
- 测试：完全没有测试覆盖
- 文档：缺少 API 文档和开发指南

**目标:**
分阶段修复技术债务，优先处理安全和架构问题，确保代码库的健康性和可维护性。

---

## Phase 1: 安全加固 (Critical - Week 1)

### 1.1 修复 API Key 哈希安全性

**问题:**
- `packages/core/src/index.ts` 使用不安全的 SHA-256 无盐哈希
- `apps/agent/src/auth.ts` 有正确的 bcrypt 实现，但未共享

**修复步骤:**

1. **安装 bcrypt 依赖到 core 包**
   ```bash
   pnpm --filter @gird/core add bcrypt
   pnpm --filter @gird/core add -D @types/bcrypt
   ```

2. **修改 `packages/core/src/index.ts`**
   ```typescript
   import bcrypt from 'bcrypt';

   const SALT_ROUNDS = 10;

   export async function hashApiKey(key: string): Promise<string> {
     return bcrypt.hash(key, SALT_ROUNDS);
   }

   export async function verifyApiKey(key: string, hash: string): Promise<boolean> {
     return bcrypt.compare(key, hash);
   }
   ```

3. **更新 `apps/agent/src/auth.ts`**
   - 移除本地 bcrypt 实现
   - 从 `@gird/core` 导入 `hashApiKey` 和 `verifyApiKey`

**验证:**
- 创建测试 key 并验证哈希与原有 bcrypt 兼容
- 确保 agent 认证仍然正常工作

---

### 1.2 添加 API Key 前缀索引

**问题:**
N+1 查询问题：加载所有 API key 并逐一比较

**修复步骤:**

1. **修改 `prisma/schema.prisma`**
   ```prisma
   model ApiKey {
     id          String   @id @default(cuid())
     tenantId    String?
     tenant      Tenant?  @relation(fields: [tenantId], references: [id], onDelete: SetNull)
     key         String   @unique
     keyPrefix   String   // 新增：存储 key 的前 8 个字符
     keyHash     String   @unique
     name        String
     permissions Json
     ipWhitelist Json     @default("[]")
     expiresAt   DateTime?
     lastUsedAt  DateTime?
     createdAt   DateTime @default(now())
     updatedAt   DateTime @default(now())

     @@index([keyPrefix])  // 新增索引
     @@index([lastUsedAt])
     @@index([expiresAt])
   }
   ```

2. **修改 `apps/agent/src/auth.ts`**
   ```typescript
   // 提取前缀
   const keyPrefix = key.slice(0, 8);

   // 按前缀查询
   const apiKeys = await prisma.apiKey.findMany({
     where: { keyPrefix }
   });

   // 逐个验证
   for (const record of apiKeys) {
     if (await verifyApiKey(key, record.keyHash)) {
       return record;
     }
   }
   ```

3. **运行迁移**
   ```bash
   pnpm db:generate
   pnpm db:push
   ```

**验证:**
- 测试 API key 验证性能
- 确认查询计划使用索引

---

### 1.3 修复 Shell 注入漏洞

**问题:**
`apps/agent/src/deployment/docker-compose.ts` 中直接插值用户输入到 shell 命令

**修复步骤:**

1. **修改 `apps/agent/src/deployment/docker-compose.ts`**
   ```typescript
   import { spawn } from 'child_process';
   import { quote } from 'shell-quote';  // 需要安装

   // 替换 execAsync 为 spawn
   async function dockerCompose(args: string[], cwd: string): Promise<void> {
     return new Promise((resolve, reject) => {
       const child = spawn('docker', ['compose', ...args], {
         cwd,
         stdio: 'pipe'
       });

       let output = '';
       let error = '';

       child.stdout?.on('data', (data) => { output += data; });
       child.stderr?.on('data', (data) => { error += data; });

       child.on('close', (code) => {
         if (code === 0) resolve();
         else reject(new Error(`docker-compose failed: ${error}`));
       });
     });
   }
   ```

**验证:**
- 测试包含特殊字符的 serverId 和 serverName

---

### 1.4 修复自动重启无限递归

**问题:**
`apps/agent/src/health/auto-restart.ts` 中递归调用 `handleCrash`

**修复步骤:**

修改 `apps/agent/src/health/auto-restart.ts`:
```typescript
async handleCrash(deploymentId: string): Promise<void> {
  const MAX_RETRIES = 5;
  let retryCount = this.retryCounts.get(deploymentId) || 0;

  if (retryCount >= MAX_RETRIES) {
    this.logger.error(`Max retries exceeded for deployment ${deploymentId}`);
    return;
  }

  const backoffMs = this.calculateBackoff(retryCount);

  while (retryCount < MAX_RETRIES) {
    try {
      await this.sleep(backoffMs);
      await this.restart(deploymentId);
      this.retryCounts.set(deploymentId, retryCount + 1);
      return;  // 成功后退出
    } catch (error) {
      retryCount++;
      this.retryCounts.set(deploymentId, retryCount);
      if (retryCount >= MAX_RETRIES) {
        this.logger.error(`Max retries exceeded for deployment ${deploymentId}`);
        return;
      }
    }
  }
}
```

**验证:**
- 模拟持续失败的场景
- 确认不会无限递归

---

### 1.5 统一 PrismaClient 单例

**问题:**
多个文件创建独立的 PrismaClient 实例

**修复步骤:**

1. **创建 `packages/core/src/database.ts`**
   ```typescript
   import { PrismaClient } from '@gird/prisma';

   let prismaInstance: PrismaClient | null = null;

   export function getPrisma(): PrismaClient {
     if (!prismaInstance) {
       prismaInstance = new PrismaClient({
         log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
       });
     }
     return prismaInstance;
   }

   export async function disconnectPrisma(): Promise<void> {
     if (prismaInstance) {
       await prismaInstance.$disconnect();
       prismaInstance = null;
     }
   }
   ```

2. **更新所有使用 PrismaClient 的文件**
   - `apps/agent/src/index.ts`
   - `apps/agent/src/health/checker.ts`
   - `apps/agent/src/health/auto-restart.ts`
   - `apps/agent/src/realtime/events.ts`
   - `apps/agent/src/metrics/collector.ts`

**验证:**
- 检查数据库连接数
- 确认优雅关闭正确断开连接

---

### 1.6 添加数据库索引

**问题:**
缺少常用查询字段的索引

**修复步骤:**

修改 `prisma/schema.prisma`:
```prisma
model ApiKey {
  // ... existing fields
  @@index([lastUsedAt])
  @@index([expiresAt])
  @@index([tenantId])
}

model AuditLog {
  // ... existing fields
  @@index([tenantId, action, createdAt])
  @@index([createdAt])
}

model UsageRecord {
  // ... existing fields
  @@index([tenantId, metricName, timestamp])
  @@index([apiKeyId, timestamp])
}
```

运行迁移: `pnpm db:push`

**验证:**
- 检查查询计划

---

### 1.7 替换 console.log 为 logger

**问题:**
多个文件使用 `console.log` 而非统一的 logger

**修复步骤:**

更新以下文件，将 `console.log/error` 替换为 logger:
- `apps/agent/src/health/auto-restart.ts`
- `apps/agent/src/realtime/sse.ts`

**验证:**
- 确保所有日志通过统一 logger 输出

---

### 1.8 添加 API Server 认证中间件

**问题:**
API Server 完全没有认证/授权

**修复步骤:**

1. **创建 `packages/server/src/middleware/auth.ts`**
   ```typescript
   import { FastifyRequest, FastifyReply } from 'fastify';
   import { AuthenticationError, AuthorizationError } from '@gird/core';

   export interface AuthContext {
     apiKeyId: string;
     tenantId?: string;
     permissions: Record<string, unknown>;
   }

   declare module 'fastify' {
     interface FastifyRequest {
       auth?: AuthContext;
     }
   }

   export async function authHook(
     request: FastifyRequest,
     reply: FastifyReply
   ): Promise<void> {
     const authHeader = request.headers.authorization;

     if (!authHeader?.startsWith('Bearer ')) {
       throw new AuthenticationError('Missing or invalid Authorization header');
     }

     const key = authHeader.slice(7);
     // 验证 key...
   }

   export function optionalAuthHook() {
     return async (request: FastifyRequest, reply: FastifyReply) => {
       const authHeader = request.headers.authorization;
       if (authHeader?.startsWith('Bearer ')) {
         // 可选验证...
       }
     };
   }
   ```

2. **应用到需要认证的路由**

**验证:**
- 测试无 token 的请求被拒绝
- 测试有效 token 可以访问

---

### 1.9 修复内存泄漏风险

**问题:**
进程/容器退出后资源未清理

**修复步骤:**

1. **修改 `apps/agent/src/deployment/local-process.ts`**
   ```typescript
   childProcess.on('exit', (code, signal) => {
     logger.info(`[${serverName}] Process exited`, { code, signal });
     addLog(`[system] Process exited with code ${code}, signal ${signal}`);

     // 清理日志缓冲区
     handle.logs = [];
     runningProcesses.delete(serverId);
   });
   ```

2. **添加启动时恢复机制**
   ```typescript
   async function reconcileOnStartup(): Promise<void> {
     const runningDeployments = await prisma.deployment.findMany({
       where: { status: 'RUNNING' }
     });

     for (const deployment of runningDeployments) {
       // 检查进程是否实际运行
       // 如果不运行，更新状态
     }
   }
   ```

**验证:**
- 监控内存使用
- 测试 agent 重启后的状态

---

### 1.10 移除不安全的类型断言

**问题:**
多处使用 `as any`, `as never` 绕过类型检查

**修复步骤:**

1. **创建类型守卫**
   ```typescript
   // packages/core/src/type-guards.ts
   export function isStdioServerConfig(config: unknown): config is StdioServerConfig {
     return (
       typeof config === 'object' && config !== null &&
       'command' in config && typeof config.command === 'string'
     );
   }
   ```

2. **替换所有 `as any` 为类型守卫或验证**

**验证:**
- 运行 `pnpm -r typecheck`

---

## Phase 2: 架构改进 (High Priority - Week 2-3)

### 2.1 创建 API Server 服务层

**问题:**
业务逻辑在路由处理器中，无法测试和复用

**修复步骤:**

1. **创建服务目录结构**
   ```
   packages/server/src/services/
   ├── index.ts
   ├── server.service.ts
   ├── api-key.service.ts
   ├── deployment.service.ts
   └── agent-client.service.ts
   ```

2. **实现 ServerService**
   ```typescript
   // packages/server/src/services/server.service.ts
   export class ServerService {
     constructor(private prisma: PrismaClient) {}

     async list(filters: ServerFilters): Promise<ServerResponse[]> {
       // ...
     }

     async findById(id: string): Promise<ServerResponse | null> {
       // ...
     }

     async create(data: CreateServerRequest): Promise<ServerResponse> {
       // ...
     }

     async update(id: string, data: UpdateServerRequest): Promise<ServerResponse> {
       // ...
     }

     async delete(id: string): Promise<void> {
       // ...
     }

     async checkNameAvailable(name: string, excludeId?: string): Promise<boolean> {
       // ...
     }
   }
   ```

3. **实现 AgentClientService**
   ```typescript
   // packages/server/src/services/agent-client.service.ts
   export class AgentClientService {
     private baseUrl: string;

     constructor(config: { host: string; port: string }) {
       this.baseUrl = `http://${config.host}:${config.port}`;
     }

     async startDeployment(serverId: string, options?: StartDeploymentOptions): Promise<DeploymentResponse> {
       // 统一的 agent 通信逻辑
     }

     async stopDeployment(serverId: string): Promise<StopDeploymentResponse> {
       // ...
     }

     async getLogs(serverId: string, options: GetLogsOptions): Promise<LogsResponse> {
       // ...
     }

     async getDeploymentStatus(serverId: string): Promise<DeploymentStatusResponse> {
       // ...
     }
   }
   ```

4. **重构路由使用服务层**

**验证:**
- 单元测试服务层
- 确认路由代码简化

---

### 2.2 标准化 API 响应格式

**问题:**
不同端点返回不同格式的响应

**修复步骤:**

1. **定义标准响应类型**
   ```typescript
   // packages/core/src/types.ts
   export interface ApiResponse<T> {
     data: T;
     success: true;
   }

   export interface ApiError {
     error: string;
     code: string;
     details?: unknown;
     success: false;
   }

   export interface PaginatedResponse<T> {
     data: T[];
     pagination: {
       page: number;
       pageSize: number;
       total: number;
       totalPages: number;
     };
     success: true;
   }
   ```

2. **创建响应辅助函数**
   ```typescript
   // packages/server/src/utils/response.ts
   export function success<T>(data: T): ApiResponse<T> {
     return { data, success: true };
   }

   export function paginated<T>(
     items: T[],
     page: number,
     pageSize: number,
     total: number
   ): PaginatedResponse<T> {
     return {
       data: items,
       pagination: {
         page,
         pageSize,
         total,
         totalPages: Math.ceil(total / pageSize)
       },
       success: true
     };
   }
   ```

3. **更新所有路由使用标准格式**

**验证:**
- 确认所有端点响应格式一致

---

### 2.3 添加分页支持

**问题:**
列表端点无分页，性能问题

**修复步骤:**

1. **创建分页 schema**
   ```typescript
   // packages/server/src/schemas.ts
   export const PaginationSchema = z.object({
     page: z.coerce.number().min(1).default(1),
     pageSize: z.coerce.number().min(1).max(100).default(20),
   });

   export const ServerQuerySchema = PaginationSchema.extend({
     type: z.enum(['STDIO', 'SSE', 'AWS_LAMBDA', 'EXECUTABLE']).optional(),
     status: z.enum(['ACTIVE', 'STOPPED', 'ERROR']).optional(),
     search: z.string().optional(),
   });
   ```

2. **更新服务层支持分页**
   ```typescript
   async list(filters: ServerQuery): Promise<PaginatedResponse<ServerResponse>> {
     const { page, pageSize, type, status, search } = filters;

     const where = {
       ...(type && { type }),
       ...(status && { status }),
       ...(search && {
         OR: [
           { name: { contains: search, mode: 'insensitive' as const } },
           { description: { contains: search, mode: 'insensitive' as const } },
         ],
       }),
     };

     const [total, servers] = await Promise.all([
       this.prisma.server.count({ where }),
       this.prisma.server.findMany({
         where,
         skip: (page - 1) * pageSize,
         take: pageSize,
         orderBy: { createdAt: 'desc' },
       }),
     ]);

     return paginated(servers, page, pageSize, total);
   }
   ```

**验证:**
- 测试大量数据场景
- 验证分页元数据正确

---

### 2.4 合并重复代码

**问题:**
API Key 生成函数在多处重复定义

**修复步骤:**

1. **统一到 `@gird/core`**
   - 确保 `generateApiKey()` 和 `hashApiKey()` 在 core 包中
   - 移除 `apps/agent/src/auth.ts` 中的重复实现

2. **更新所有导入**

**验证:**
- 搜索代码库确保无重复实现

---

### 2.5 添加请求日志中间件

**问题:**
只有错误日志，无请求日志

**修复步骤:**

1. **创建 `packages/server/src/middleware/logger.ts`**
   ```typescript
   import { FastifyRequest, FastifyReply } from 'fastify';
   import { logger } from '@gird/core';

   export async function requestLoggerHook(
     request: FastifyRequest,
     reply: FastifyReply
   ): Promise<void> {
     const startTime = Date.now();

     reply.raw.setHeader('X-Request-ID', request.id);

     reply.addHook('onSend', async () => {
       const duration = Date.now() - startTime;
       logger.info('API Request', {
         method: request.method,
         url: request.url,
         status: reply.statusCode,
         duration,
         requestId: request.id,
         ip: request.ip,
       });
     });
   }
   ```

2. **注册到 Fastify**

**验证:**
- 检查日志输出

---

### 2.6 添加请求超时

**问题:**
代理请求无超时，可能挂起

**修复步骤:**

1. **修改 `apps/agent/src/proxy.ts`**
   ```typescript
   const PROXY_TIMEOUT = 30000; // 30 seconds

   const response = await fetch(url, {
     ...init,
     signal: AbortSignal.timeout(PROXY_TIMEOUT),
   });
   ```

2. **为 Docker 操作添加超时**

**验证:**
- 测试超时场景

---

### 2.7 添加 SSE 连接限制

**问题:**
无并发 SSE 连接限制

**修复步骤:**

1. **修改 `apps/agent/src/realtime/sse.ts`**
   ```typescript
   const MAX_SSE_CONNECTIONS = 100;

   export class SSEManager {
     private connectionCount = 0;

     connect(client: SSEClient): boolean {
       if (this.connectionCount >= MAX_SSE_CONNECTIONS) {
         return false;
       }
       this.connectionCount++;
       return true;
     }

     disconnect(clientId: string): void {
       // ...
       this.connectionCount--;
     }
   }
   ```

**验证:**
- 测试连接限制

---

### 2.8 修复竞态条件

**问题:**
进程停止时 timeout 和 exit 处理器可能重复调用清理

**修复步骤:**

1. **修改 `apps/agent/src/deployment/local-process.ts`**
   ```typescript
   return new Promise((resolve) => {
     let cleaned = false;

     const cleanup = () => {
       if (cleaned) return;
       cleaned = true;
       runningProcesses.delete(serverId);
       resolve();
     };

     const timeout = setTimeout(() => {
       logger.warn(`Force killing process for server: ${serverName}`);
       handle.process.kill('SIGKILL');
       cleanup();
     }, 5000);

     handle.process.once('exit', () => {
       clearTimeout(timeout);
       cleanup();
     });
   });
   ```

**验证:**
- 测试快速停止场景

---

### 2.9 添加配置验证

**问题:**
`validateConfig()` 存在但未被调用

**修复步骤:**

1. **修改 `packages/core/src/config.ts`**
   ```typescript
   export function loadConfig(): Config {
     const config = {
       database: { url: process.env.DATABASE_URL || 'file:./dev.db' },
       agent: {
         host: process.env.AGENT_HOST || '127.0.0.1',
         port: parseInt(process.env.AGENT_PORT || '3001', 10),
       },
       api: {
         host: process.env.API_HOST || '0.0.0.0',
         port: parseInt(process.env.API_PORT || '3000', 10),
       },
       dashboard: {
         port: parseInt(process.env.DASHBOARD_PORT || '5173', 10),
       },
       apiKeySecret: process.env.API_KEY_SECRET || 'change-this-in-production',
     };

     // 自动验证
     validateConfig(config);

     return config;
   }
   ```

**验证:**
- 测试无效配置场景

---

### 2.10 创建环境变量 schema

**问题:**
环境变量无类型安全

**修复步骤:**

1. **创建 `packages/core/src/env.ts`**
   ```typescript
   import { z } from 'zod';

   const EnvSchema = z.object({
     NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
     DATABASE_URL: z.string(),
     API_KEY_SECRET: z.string().min(32),
     AGENT_HOST: z.string().default('127.0.0.1'),
     AGENT_PORT: z.coerce.number().default(3001),
     API_HOST: z.string().default('0.0.0.0'),
     API_PORT: z.coerce.number().default(3000),
     DASHBOARD_PORT: z.coerce.number().default(5173),
   });

   export type Env = z.infer<typeof EnvSchema>;

   let cachedEnv: Env | null = null;

   export function loadEnv(): Env {
     if (cachedEnv) return cachedEnv;
     cachedEnv = EnvSchema.parse(process.env);
     return cachedEnv;
   }
   ```

**验证:**
- 运行时验证所有环境变量

---

## Phase 3: Dashboard 完善 (Medium Priority - Week 4-5)

### 3.1 创建 Dashboard 组件结构

**问题:**
所有组件在单个 App.tsx 文件中

**修复步骤:**

1. **创建目录结构**
   ```
   packages/dashboard/src/
   ├── pages/
   │   ├── HomePage.tsx
   │   ├── ServersPage.tsx
   │   ├── ServerDetailPage.tsx
   │   ├── KeysPage.tsx
   │   └── KeyDetailPage.tsx
   ├── components/
   │   ├── layout/
   │   │   ├── Navbar.tsx
   │   │   ├── Sidebar.tsx
   │   │   └── Layout.tsx
   │   └── ui/
   │       ├── Button.tsx
   │       ├── Input.tsx
   │       └── ...
   ├── lib/
   │   ├── api-client.ts
   │   └── api.ts
   └── hooks/
       ├── useServers.ts
       └── useApiKeys.ts
   ```

2. **提取组件**

**验证:**
- 确认组件可独立工作

---

### 3.2 实现 API 客户端

**问题:**
Dashboard 完全没有 API 集成

**修复步骤:**

1. **创建 API 客户端**
   ```typescript
   // packages/dashboard/src/lib/api-client.ts
   import axios from 'axios';

   const api = axios.create({
     baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
     timeout: 10000,
   });

   // 请求拦截器：添加认证
   api.interceptors.request.use((config) => {
     const token = localStorage.getItem('gird_token');
     if (token) {
       config.headers.Authorization = `Bearer ${token}`;
     }
     return config;
   });

   // 响应拦截器：统一错误处理
   api.interceptors.response.use(
     (response) => response.data,
     (error) => {
       // 统一错误处理
       return Promise.reject(error);
     }
   );

   export default api;
   ```

2. **创建服务方法**
   ```typescript
   // packages/dashboard/src/lib/api.ts
   import api from './api-client';
   import type { Server, ApiKey } from '@gird/core';

   export const serverApi = {
     list: () => api.get<Server[]>('/api/servers'),
     get: (id: string) => api.get<Server>(`/api/servers/${id}`),
     create: (data: CreateServerDto) => api.post<Server>('/api/servers', data),
     update: (id: string, data: UpdateServerDto) => api.put<Server>(`/api/servers/${id}`, data),
     delete: (id: string) => api.delete(`/api/servers/${id}`),
     start: (id: string) => api.post(`/api/servers/${id}/start`),
     stop: (id: string) => api.post(`/api/servers/${id}/stop`),
     getLogs: (id: string, options?: { tail?: number }) =>
       api.get(`/api/servers/${id}/logs`, { params: options }),
   };

   export const apiKeyApi = {
     list: () => api.get<ApiKey[]>('/api/keys'),
     get: (id: string) => api.get<ApiKey>(`/api/keys/${id}`),
     create: (data: CreateApiKeyDto) => api.post<{ key: string; apiKey: ApiKey }>('/api/keys', data),
     delete: (id: string) => api.delete(`/api/keys/${id}`),
   };
   ```

**验证:**
- 测试 API 调用

---

### 3.3 实现 TanStack Query Hooks

**问题:**
TanStack Query 已安装但未使用

**修复步骤:**

1. **创建数据获取 hooks**
   ```typescript
   // packages/dashboard/src/hooks/useServers.ts
   import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
   import { serverApi } from '../lib/api';

   export function useServers() {
     return useQuery({
       queryKey: ['servers'],
       queryFn: serverApi.list,
     });
   }

   export function useServer(id: string) {
     return useQuery({
       queryKey: ['servers', id],
       queryFn: () => serverApi.get(id),
     });
   }

   export function useCreateServer() {
     const queryClient = useQueryClient();

     return useMutation({
       mutationFn: serverApi.create,
       onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['servers'] });
       },
     });
   }

   // ... 其他 hooks
   ```

**验证:**
- 测试数据获取和缓存

---

### 3.4 创建表单组件

**问题:**
缺少表单处理和验证

**修复步骤:**

1. **安装表单依赖**
   ```bash
   pnpm --filter @gird/dashboard add react-hook-form @hookform/resolvers
   ```

2. **创建 Server 表单**
   ```typescript
   // packages/dashboard/src/components/forms/CreateServerForm.tsx
   import { useForm } from 'react-hook-form';
   import { zodResolver } from '@hookform/resolvers/zod';
   import { z } from 'zod';
   import type { ServerType } from '@gird/core';

   const serverSchema = z.object({
     name: z.string().min(1).max(100),
     type: z.enum(['STDIO', 'SSE', 'AWS_LAMBDA', 'EXECUTABLE']),
     description: z.string().optional(),
   });

   export function CreateServerForm() {
     const { register, handleSubmit, formState } = useForm({
       resolver: zodResolver(serverSchema),
     });

     const createServer = useCreateServer();

     const onSubmit = async (data) => {
       await createServer.mutateAsync(data);
     };

     return (
       <form onSubmit={handleSubmit(onSubmit)}>
         {/* 表单字段 */}
       </form>
     );
   }
   ```

**验证:**
- 测试表单验证

---

### 3.5 添加加载和错误状态

**问题:**
无加载指示器和错误显示

**修复步骤:**

1. **创建 Loading 组件**
   ```typescript
   // packages/dashboard/src/components/ui/Loading.tsx
   export function Loading({ size = 'md' }) {
     return (
       <div className="flex items-center justify-center">
         <Spinner size={size} />
       </div>
     );
   }
   ```

2. **创建 ErrorBoundary**
   ```typescript
   // packages/dashboard/src/components/ErrorBoundary.tsx
   export class ErrorBoundary extends React.Component {
     // ...
   }
   ```

3. **在页面中使用**
   ```typescript
   export function ServersPage() {
     const { data, isLoading, error } = useServers();

     if (isLoading) return <Loading />;
     if (error) return <ErrorMessage error={error} />;

     return <ServerList servers={data} />;
   }
   ```

**验证:**
- 测试各种状态

---

### 3.6 添加通知系统

**问题:**
无 toast/通知反馈

**修复步骤:**

1. **安装 sonner**
   ```bash
   pnpm --filter @gird/dashboard add sonner
   ```

2. **配置 Toaster**
   ```typescript
   // packages/dashboard/src/App.tsx
   import { Toaster } from 'sonner';

   function App() {
     return (
       <>
         <Router>{/* ... */}</Router>
         <Toaster position="top-right" />
       </>
     );
   }
   ```

3. **在操作中使用**
   ```typescript
   import { toast } from 'sonner';

   export function useCreateServer() {
     return useMutation({
       mutationFn: serverApi.create,
       onSuccess: () => {
         toast.success('Server created successfully');
       },
       onError: (error) => {
         toast.error('Failed to create server', {
           description: error.message,
         });
       },
     });
   }
   ```

**验证:**
- 测试各种通知场景

---

### 3.7 添加路由保护

**问题:**
无认证状态检查

**修复步骤:**

1. **创建 ProtectedRoute**
   ```typescript
   // packages/dashboard/src/components/ProtectedRoute.tsx
   export function ProtectedRoute({ children }: { children: React.ReactNode }) {
     const token = localStorage.getItem('gird_token');

     if (!token) {
       return <Navigate to="/login" replace />;
     }

     return children;
   }
   ```

2. **包装需要认证的路由**

**验证:**
- 测试未登录访问

---

## Phase 4: CLI 改进 (Medium Priority - Week 5)

### 4.1 添加 server update 命令

**问题:**
可以创建服务器但无法更新

**修复步骤:**

1. **创建 `packages/cli/src/commands/server.ts` 中的 update 命令**
   ```typescript
   serverCmd
     .command('update <name>')
     .description('Update a server')
     .option('--type <type>', 'Server type')
     .option('--command <command>', 'Command for STDIO servers')
     .option('--url <url>', 'URL for SSE servers')
     .action(async (name, options) => {
       // 更新逻辑
     });
   ```

**验证:**
- 测试更新各种配置

---

### 4.2 添加 logs 命令

**问题:**
CLI 无法查看日志

**修复步骤:**

1. **创建 logs 命令**
   ```typescript
   serverCmd
     .command('logs <name>')
     .description('View server logs')
     .option('--follow', 'Follow log output')
     .option('--tail <lines>', 'Number of lines to show', '100')
     .action(async (name, options) => {
       // 日志获取和显示逻辑
     });
   ```

**验证:**
- 测试日志输出

---

### 4.3 修复 Prisma 连接管理

**问题:**
每个命令创建独立 Prisma 实例，无清理

**修复步骤:**

1. **创建共享数据库模块**
   ```typescript
   // packages/cli/src/lib/db.ts
   import { PrismaClient } from '@gird/prisma';

   let prisma: PrismaClient | null = null;

   export function getDb(): PrismaClient {
     if (!prisma) {
       prisma = new PrismaClient();
     }
     return prisma;
   }

   export async function closeDb(): Promise<void> {
     if (prisma) {
       await prisma.$disconnect();
       prisma = null;
     }
   }
   ```

2. **在命令退出时清理**
   ```typescript
   import { getDb, closeDb } from '../lib/db';

   process.on('exit', closeDb);
   process.on('SIGINT', async () => {
     await closeDb();
     process.exit(0);
   });
   ```

**验证:**
- 测试连接管理

---

### 4.4 添加配置文件支持

**问题:**
CLI 无配置文件

**修复步骤:**

1. **创建配置模块**
   ```typescript
   // packages/cli/src/lib/config.ts
   import { homedir } from 'os';
   import { join } from 'path';
   import { readFileSync, existsSync } from 'fs';

   interface CliConfig {
     apiEndpoint: string;
     agentEndpoint: string;
     outputFormat: 'json' | 'table' | 'plain';
   }

   const DEFAULT_CONFIG: CliConfig = {
     apiEndpoint: 'http://localhost:3000',
     agentEndpoint: 'http://localhost:3001',
     outputFormat: 'table',
   };

   const CONFIG_PATH = join(homedir(), '.gird', 'config.json');

   export function loadConfig(): CliConfig {
     if (!existsSync(CONFIG_PATH)) {
       return DEFAULT_CONFIG;
     }
     const content = readFileSync(CONFIG_PATH, 'utf-8');
     return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
   }
   ```

**验证:**
- 测试配置加载

---

## Phase 5: 测试和文档 (Low Priority - Ongoing)

### 5.1 添加单元测试

**修复步骤:**

1. **配置测试框架**
   ```bash
   pnpm add -D -w vitest
   ```

2. **创建测试文件**
   ```
   packages/*/src/**/*.test.ts
   ```

**验证:**
- 运行 `pnpm test`

---

### 5.2 添加 E2E 测试

**修复步骤:**

1. **安装 Playwright**
   ```bash
   pnpm add -D -w @playwright/test
   ```

2. **创建 E2E 测试**
   ```typescript
   // e2e/server.spec.ts
   test('create and delete server', async ({ page }) => {
     // ...
   });
   ```

**验证:**
- 运行 `pnpm test:e2e`

---

### 5.3 添加 API 文档

**修复步骤:**

1. **安装 Swagger**
   ```bash
   pnpm --filter @gird/server add @fastify/swagger @fastify/swagger-ui
   ```

2. **配置 Swagger**
   ```typescript
   await fastify.register(swagger, {
     openapi: {
       info: { title: 'Gird API', version: '1.0.0' },
     },
   });

   await fastify.register(swaggerUi, {
     routePrefix: '/docs',
   });
   ```

**验证:**
- 访问 `/docs` 查看文档

---

### 5.4 添加 CI/CD

**修复步骤:**

1. **创建 `.github/workflows/ci.yml`**
   ```yaml
   name: CI

   on: [push, pull_request]

   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v2
         - uses: actions/setup-node@v4
         - run: pnpm install
         - run: pnpm typecheck
         - run: pnpm test
         - run: pnpm lint
   ```

**验证:**
- 推送代码触发 CI

---

## 关键文件清单

### 需要创建的文件

| 文件 | 用途 | Phase |
|------|------|-------|
| `packages/core/src/database.ts` | 统一 Prisma 实例 | 1.5 |
| `packages/core/src/type-guards.ts` | 类型守卫 | 1.10 |
| `packages/core/src/env.ts` | 环境变量 schema | 2.10 |
| `packages/server/src/middleware/auth.ts` | 认证中间件 | 1.8 |
| `packages/server/src/middleware/logger.ts` | 请求日志 | 2.5 |
| `packages/server/src/services/server.service.ts` | 服务器服务 | 2.1 |
| `packages/server/src/services/agent-client.service.ts` | Agent 客户端 | 2.1 |
| `packages/server/src/utils/response.ts` | 响应辅助 | 2.2 |
| `packages/dashboard/src/lib/api-client.ts` | API 客户端 | 3.2 |
| `packages/dashboard/src/lib/api.ts` | API 服务 | 3.2 |
| `packages/dashboard/src/hooks/useServers.ts` | 数据 hooks | 3.3 |
| `packages/dashboard/src/components/forms/CreateServerForm.tsx` | 表单 | 3.4 |
| `packages/cli/src/lib/db.ts` | CLI 数据库 | 4.3 |
| `packages/cli/src/lib/config.ts` | CLI 配置 | 4.4 |

### 需要修改的文件

| 文件 | 修改内容 | Phase |
|------|---------|-------|
| `packages/core/src/index.ts` | 使用 bcrypt | 1.1 |
| `apps/agent/src/auth.ts` | 使用 core 哈希 | 1.1 |
| `prisma/schema.prisma` | 添加索引和 keyPrefix | 1.2, 1.6 |
| `apps/agent/src/deployment/docker-compose.ts` | 修复 shell 注入 | 1.3 |
| `apps/agent/src/health/auto-restart.ts` | 修复递归 | 1.4 |
| `apps/agent/src/deployment/local-process.ts` | 清理资源 | 1.9 |
| `apps/agent/src/proxy.ts` | 添加超时 | 2.6 |
| `apps/agent/src/realtime/sse.ts` | 连接限制 | 2.7 |
| `packages/core/src/config.ts` | 自动验证 | 2.9 |
| `packages/server/src/routes/servers.ts` | 使用服务层 | 2.1 |
| `packages/server/src/routes/keys.ts` | 标准化响应 | 2.2 |
| `packages/dashboard/src/App.tsx` | 分离组件 | 3.1 |

---

## 实施顺序

1. **Phase 1** (Critical - Week 1) - 安全和稳定性
2. **Phase 2** (High Priority - Week 2-3) - 架构和服务层
3. **Phase 3** (Medium Priority - Week 4-5) - Dashboard 完善
4. **Phase 4** (Medium Priority - Week 5) - CLI 改进
5. **Phase 5** (Low Priority - Ongoing) - 测试和文档

---

## 验证步骤

每个 Phase 完成后：

1. **类型检查**: `pnpm -r typecheck`
2. **Lint**: `pnpm lint`
3. **构建**: `pnpm build`
4. **测试**: `pnpm test` (添加测试后)
5. **手动测试**: 启动所有服务，测试关键流程

---

## 估计工作量

| Phase | 周数 | 主要工作 |
|-------|------|----------|
| Phase 1 | 1 周 | 安全修复、资源管理 |
| Phase 2 | 2 周 | 架构重构、服务层 |
| Phase 3 | 2 周 | Dashboard 完善 |
| Phase 4 | 1 周 | CLI 改进 |
| Phase 5 | 持续 | 测试和文档 |

**总计**: 约 6 周完成主要修复
