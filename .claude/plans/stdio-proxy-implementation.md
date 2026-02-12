# STDIO MCP Server 代理实现计划

## Context

当前 Gird Agent 的 `proxy.ts` 只支持将 HTTP 请求转发到远程 SSE 端点。对于 STDIO 类型的 MCP 服务器，需要实现完整的 stdin/stdout JSON-RPC 通信机制。

## 问题分析

### 当前实现 (`apps/agent/src/proxy.ts`)

```typescript
// 当前只支持 HTTP/SSE 服务器代理
const response = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(jsonRpcRequest)
});
```

### STDIO MCP Server 通信协议

STDIO 类型服务器通过 stdin/stdout 进行通信：
1. **请求格式**: JSON-RPC 2.0 对象，单行 JSON
2. **响应格式**: JSON-RPC 2.0 响应，单行 JSON
3. **生命周期**: 进程启动 → initialize → 请求/响应 → 进程退出

---

## Phase 1: STDIO 进程管理器

### 1.1 创建 STDIO 进程池

**文件**: `apps/agent/src/stdio/process-pool.ts`

```typescript
import { spawn, ChildProcess } from 'child_process';
import { logger } from '@gird/core';

interface StdioProcess {
  serverId: string;
  process: ChildProcess;
  initialized: boolean;
  lastUsed: Date;
}

export class StdioProcessPool {
  private processes = new Map<string, StdioProcess>();

  async get(serverId: string, config: StdioServerConfig): Promise<StdioProcess> {
    const existing = this.processes.get(serverId);
    if (existing && !existing.process.killed) {
      return existing;
    }

    return this.spawn(serverId, config);
  }

  private async spawn(serverId: string, config: StdioServerConfig): Promise<StdioProcess> {
    const args = config.args ?? [];

    const child = spawn(config.command, args, {
      env: config.env ?? process.env,
      cwd: config.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdioProcess: StdioProcess = {
      serverId,
      process: child,
      initialized: false,
      lastUsed: new Date(),
    };

    // Handle stdout for responses
    const responseBuffer = new ResponseBuffer();
    child.stdout?.on('data', (data) => {
      responseBuffer.feed(data);
    });

    // Handle stderr for logging
    child.stderr?.on('data', (data) => {
      logger.warn(`[${serverId}] stderr: ${data.toString()}`);
    });

    // Handle process exit
    child.on('exit', (code) => {
      logger.info(`[${serverId}] Process exited with code ${code}`);
      this.processes.delete(serverId);
    });

    this.processes.set(serverId, stdioProcess);
    return stdioProcess;
  }

  async terminate(serverId: string): Promise<void> {
    const proc = this.processes.get(serverId);
    if (proc) {
      proc.process.kill('SIGTERM');
      // Force kill after 5s
      setTimeout(() => {
        if (!proc.process.killed) {
          proc.process.kill('SIGKILL');
        }
      }, 5000);
    }
  }
}
```

### 1.2 响应缓冲区

**文件**: `apps/agent/src/stdio/response-buffer.ts`

```typescript
/**
 * Buffer for handling multi-line JSON-RPC responses
 * STDIO servers may send partial JSON across multiple stdout chunks
 */
export class ResponseBuffer {
  private buffer = '';
  private resolveResponse?: (value: unknown) => void;
  private rejectResponse?: (error: Error) => void;

  feed(data: Buffer): void {
    this.buffer += data.toString('utf-8');
    this.tryParse();
  }

  private tryParse(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        try {
          const response = JSON.parse(line);
          this.resolveResponse?.(response);
        } catch (error) {
          logger.error(`Failed to parse JSON: ${line}`);
        }
      }
    }
  }

  async waitForResponse(timeout = 30000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.resolveResponse = resolve;
      this.rejectResponse = reject;

      setTimeout(() => {
        reject(new Error('Response timeout'));
      }, timeout);
    });
  }

  reset(): void {
    this.buffer = '';
    this.resolveResponse = undefined;
    this.rejectResponse = undefined;
  }
}
```

---

## Phase 2: STDIO 代理实现

### 2.1 更新 proxy.ts

**文件**: `apps/agent/src/proxy.ts`

```typescript
import { stdioProcessPool } from './stdio/process-pool.js';

export async function handleProxyRequest(
  serverId: string,
  jsonRpcRequest: JsonRpcRequest,
  signal: AbortSignal
): Promise<JsonRpcResponse> {
  const server = await getServerById(serverId);

  if (!server) {
    throw new ProxyError('Server not found');
  }

  // Handle SSE servers (existing implementation)
  if (server.type === 'SSE') {
    return handleSseProxy(server, jsonRpcRequest, signal);
  }

  // Handle STDIO servers (new implementation)
  if (server.type === 'STDIO') {
    return handleStdioProxy(server, jsonRpcRequest);
  }

  throw new ProxyError(`Unsupported server type: ${server.type}`);
}

async function handleStdioProxy(
  server: Server & { config: StdioServerConfig },
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  const stdioProc = await stdioProcessPool.get(server.id, server.config);

  // Initialize if not already
  if (!stdioProc.initialized) {
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'gird-agent', version: '1.0.0' }
      }
    };

    await sendRequest(stdioProc, initRequest);
    stdioProc.initialized = true;
  }

  // Send the actual request
  return await sendRequest(stdioProc, request);
}

async function sendRequest(
  stdioProc: StdioProcess,
  request: JsonRpcRequest
): Promise<JsonRpcResponse> {
  const responseBuffer = new ResponseBuffer();

  // Set up one-time listener for this response
  const response = await responseBuffer.waitForResponse();

  // Write request to stdin
  stdioProc.process.stdin?.write(JSON.stringify(request) + '\n');

  return response as JsonRpcResponse;
}
```

---

## Phase 3: 生命周期管理

### 3.1 启动时恢复 STDIO 进程

**文件**: `apps/agent/src/deployment/local-process.ts`

在现有的 `startLocalProcess` 中，将进程引用保存到 STDIO 进程池：

```typescript
export async function startLocalProcess(
  serverId: string,
  serverName: string,
  config: StdioServerConfig
): Promise<void> {
  // ... existing process spawn code ...

  // Register with STDIO pool for proxy use
  const { stdioProcessPool } = await import('../stdio/process-pool.js');
  stdioProcessPool.registerManualProcess(serverId, childProcess);
}
```

### 3.2 停止时清理

```typescript
export async function stopLocalProcess(
  serverId: string,
  serverName: string
): Promise<void> {
  // ... existing stop code ...

  // Unregister from STDIO pool
  const { stdioProcessPool } = await import('../stdio/process-pool.js');
  await stdioProcessPool.terminate(serverId);
}
```

---

## Phase 4: 错误处理和重试

### 4.1 进程崩溃恢复

- 检测 STDIO 进程意外退出
- 自动重启机制
- 最大重试次数限制

### 4.2 请求超时处理

- JSON-RPC 请求超时（默认 30 秒）
- 超时后重启进程
- 返回适当错误给客户端

---

## Phase 5: 测试计划

### 5.1 单元测试

- `process-pool.test.ts` - 进程池管理
- `response-buffer.test.ts` - 响应缓冲区解析

### 5.2 集成测试

- 测试完整 STDIO 代理流程
- 测试多请求并发
- 测试进程崩溃恢复

### 5.3 E2E 测试

- 使用真实 MCP server（如 `@modelcontextprotocol/server-everything`）
- 验证所有 MCP 方法（tools, resources, prompts）

---

## 文件清单

### 需要创建的文件

| 文件 | 用途 |
|------|------|
| `apps/agent/src/stdio/process-pool.ts` | STDIO 进程管理 |
| `apps/agent/src/stdio/response-buffer.ts` | 响应缓冲区 |
| `apps/agent/src/stdio/index.ts` | 导出入口 |

### 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `apps/agent/src/proxy.ts` | 添加 STDIO 代理逻辑 |
| `apps/agent/src/deployment/local-process.ts` | 集成进程池 |
| `apps/agent/src/index.ts` | 注册进程池清理 |

---

## 估计工作量

| Phase | 描述 | 时间 |
|-------|--------|------|
| Phase 1 | STDIO 进程管理器 | 2-3 天 |
| Phase 2 | STDIO 代理实现 | 2-3 天 |
| Phase 3 | 生命周期管理 | 1 天 |
| Phase 4 | 错误处理和重试 | 1-2 天 |
| Phase 5 | 测试 | 2-3 天 |

**总计**: 约 8-12 天

---

## 技术考量

### 并发请求处理

STDIO 服务器通常一次处理一个请求。需要考虑：
1. **请求队列**: 按序处理请求
2. **并发限制**: 拒绝或排队并发请求

### 资源限制

- 最大并发 STDIO 进程数
- 每个进程内存限制
- 进程空闲超时自动清理

---

## 参考资料

- [MCP Specification - STDIO Transport](https://spec.modelcontextprotocol.io/specification/version-2024-11-05/#stdinstdio-transport)
- [Node.js child_process docs](https://nodejs.org/api/child_process)
