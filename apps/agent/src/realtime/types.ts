/**
 * Real-time communication types
 */

import type { ServerEvent } from '@gird-mcp/core';

// SSE-specific control events (not part of ServerEvent)
export interface SSEControlEvent {
  type: 'connected' | 'subscribed' | 'unsubscribed';
  data: { clientId?: string; channel?: string };
  timestamp: Date;
}

// Union type for all SSE messages
export type SSEMessage = ServerEvent | SSEControlEvent;

export interface SSEClient {
  id: string;
  deploymentId?: string;
  serverId?: string;
  tenantId?: string;
  response: {
    write: (chunk: string) => boolean;
    writeHead: (statusCode: number, headers: Record<string, string>) => void;
    on: (event: string, handler: () => void) => void;
    raw: unknown;
  };
  ipAddress: string;
  subscribedChannels: Set<string>;
}

export interface EventChannel {
  name: string;
  clients: Set<SSEClient>;
}

export type EventHandler = (event: ServerEvent) => void;

export interface RealTimeManager {
  broadcast(event: ServerEvent): void;
  subscribe(clientId: string, channels: string[]): void;
  unsubscribe(clientId: string, channels?: string[]): void;
  disconnect(clientId: string): void;
  on(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
}

// SSE event types
export const SSE_CHANNELS = {
  ALL: 'all',
  DEPLOYMENT_STATUS: 'deployment_status',
  HEALTH_STATUS: 'health_status',
  LOGS: 'logs',
  METRICS: 'metrics',
  ERRORS: 'errors',
} as const;

export type SSEChannel = typeof SSE_CHANNELS[keyof typeof SSE_CHANNELS];
