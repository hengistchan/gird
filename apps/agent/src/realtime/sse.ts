/**
 * SSE (Server-Sent Events) manager for real-time updates
 */

import { randomUUID } from 'node:crypto';
import { logger } from '@gird/core';
import type { ServerEvent } from '@gird/core';
import type { SSEClient, EventChannel, RealTimeManager, EventHandler, SSEMessage } from './types.js';

const MAX_SSE_CONNECTIONS = 100;
const MAX_SSE_CONNECTIONS_PER_TENANT = 10;

export interface ConnectionLimitResult {
  success: boolean;
  reason?: string;
}

export interface ConnectionStats {
  total: number;
  byTenant: Record<string, number>;
  limit: {
    maxGlobal: number;
    maxPerTenant: number;
  };
}

export class SSEManager implements RealTimeManager {
  private clients = new Map<string, SSEClient>();
  private channels = new Map<string, EventChannel>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private connectionCount = 0;
  private tenantConnectionCounts = new Map<string, number>();

  /**
   * Check if a new connection can be accepted
   */
  canConnect(tenantId: string | undefined): ConnectionLimitResult {
    // Check global limit
    if (this.connectionCount >= MAX_SSE_CONNECTIONS) {
      return {
        success: false,
        reason: 'Maximum concurrent connections reached',
      };
    }

    // Check per-tenant limit
    if (tenantId) {
      const tenantCount = this.tenantConnectionCounts.get(tenantId) || 0;
      if (tenantCount >= MAX_SSE_CONNECTIONS_PER_TENANT) {
        return {
          success: false,
          reason: 'Maximum concurrent connections for tenant',
        };
      }
    }

    return { success: true };
  }

  /**
   * Register a new SSE client
   */
  registerClient(
    clientId: string,
    response: SSEClient['response'],
    metadata: {
      deploymentId?: string;
      serverId?: string;
      tenantId?: string;
      ipAddress: string;
    }
  ): SSEClient {
    // Update connection counts
    this.connectionCount++;
    if (metadata.tenantId) {
      this.tenantConnectionCounts.set(
        metadata.tenantId,
        (this.tenantConnectionCounts.get(metadata.tenantId) || 0) + 1
      );
    }

    const client: SSEClient = {
      id: clientId,
      ...metadata,
      response,
      ipAddress: metadata.ipAddress,
      subscribedChannels: new Set(),
    };

    this.clients.set(clientId, client);

    // Send initial connection message
    this.sendToClient(client, {
      type: 'connected',
      data: { clientId: client.id },
      timestamp: new Date(),
    });

    return client;
  }

  /**
   * Subscribe a client to channels
   */
  subscribe(clientId: string, channels: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    for (const channelName of channels) {
      // Get or create channel
      let channel = this.channels.get(channelName);
      if (!channel) {
        channel = { name: channelName, clients: new Set() };
        this.channels.set(channelName, channel);
      }

      // Add client to channel
      channel.clients.add(client);
      client.subscribedChannels.add(channelName);

      // Send subscription confirmation
      this.sendToClient(client, {
        type: 'subscribed',
        data: { channel: channelName },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Unsubscribe a client from channels
   */
  unsubscribe(clientId: string, channels?: string[]): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const channelsToUnsubscribe = channels ?? Array.from(client.subscribedChannels);

    for (const channelName of channelsToUnsubscribe) {
      const channel = this.channels.get(channelName);
      if (channel) {
        channel.clients.delete(client);
        client.subscribedChannels.delete(channelName);

        // Clean up empty channels
        if (channel.clients.size === 0) {
          this.channels.delete(channelName);
        }
      }

      // Send unsubscription confirmation
      this.sendToClient(client, {
        type: 'unsubscribed',
        data: { channel: channelName },
        timestamp: new Date(),
      });
    }
  }

  /**
   * Disconnect a client
   */
  disconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Update connection counts
    this.connectionCount = Math.max(0, this.connectionCount - 1);
    if (client.tenantId) {
      const count = this.tenantConnectionCounts.get(client.tenantId) || 0;
      if (count <= 1) {
        this.tenantConnectionCounts.delete(client.tenantId);
      } else {
        this.tenantConnectionCounts.set(client.tenantId, count - 1);
      }
    }

    // Unsubscribe from all channels
    this.unsubscribe(clientId);

    // Remove client
    this.clients.delete(clientId);
  }

  /**
   * Broadcast an event to all relevant subscribers
   */
  broadcast(event: ServerEvent): void {
    // Emit to local event handlers
    const handlers = this.eventHandlers.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          logger.error('Error in event handler', errorObj);
        }
      }
    }

    // Determine which channels to send to
    const targetChannels = this.determineTargetChannels(event);

    // Send to subscribed clients
    for (const channelName of targetChannels) {
      const channel = this.channels.get(channelName);
      if (!channel) continue;

      for (const client of channel.clients) {
        // Filter by tenant if tenantId is set
        if (event.tenantId && client.tenantId && event.tenantId !== client.tenantId) {
          continue;
        }

        // Filter by server if serverId is set
        if (event.serverId && client.serverId && event.serverId !== client.serverId) {
          continue;
        }

        // Filter by deployment if deploymentId is set
        if (event.deploymentId && client.deploymentId && event.deploymentId !== client.deploymentId) {
          continue;
        }

        this.sendToClient(client, event);
      }
    }

    // Also send to 'all' channel subscribers
    const allChannel = this.channels.get('all');
    if (allChannel) {
      for (const client of allChannel.clients) {
        // Apply same filters
        if (event.tenantId && client.tenantId && event.tenantId !== client.tenantId) {
          continue;
        }
        if (event.serverId && client.serverId && event.serverId !== client.serverId) {
          continue;
        }
        if (event.deploymentId && client.deploymentId && event.deploymentId !== client.deploymentId) {
          continue;
        }

        this.sendToClient(client, event);
      }
    }
  }

  /**
   * Register event handler
   */
  on(event: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  /**
   * Unregister event handler
   */
  off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(event);
      }
    }
  }

  /**
   * Get active client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get channel statistics
   */
  getChannelStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [name, channel] of this.channels) {
      stats[name] = channel.clients.size;
    }
    return stats;
  }

  /**
   * Get connection statistics including limits
   */
  getConnectionStats(): ConnectionStats {
    return {
      total: this.connectionCount,
      byTenant: Object.fromEntries(this.tenantConnectionCounts),
      limit: {
        maxGlobal: MAX_SSE_CONNECTIONS,
        maxPerTenant: MAX_SSE_CONNECTIONS_PER_TENANT,
      },
    };
  }

  /**
   * Send event to a specific client
   */
  private sendToClient(client: SSEClient, event: SSEMessage): boolean {
    try {
      const data = `data: ${JSON.stringify(event)}\n\n`;
      return client.response.write(data);
    } catch (error) {
      // Client disconnected, remove them
      this.disconnect(client.id);
      return false;
    }
  }

  /**
   * Determine which channels an event should be sent to
   */
  private determineTargetChannels(event: ServerEvent): string[] {
    const channels: string[] = [];

    switch (event.type) {
      case 'deployment_status':
        channels.push('deployment_status');
        break;
      case 'health_status':
        channels.push('health_status');
        break;
      case 'log':
        channels.push('logs');
        break;
      case 'metric':
        channels.push('metrics');
        break;
      case 'error':
        channels.push('errors');
        break;
    }

    return channels;
  }
}

// Export singleton instance
export const sseManager = new SSEManager();

/**
 * Generate a unique client ID
 */
export function generateClientId(): string {
  return `sse_${randomUUID()}`;
}
