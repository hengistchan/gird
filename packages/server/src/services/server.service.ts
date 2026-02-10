/**
 * Server Service - Business logic for server management
 */

import { PrismaClient } from '@prisma/client';
import { getPrisma, createLogger } from '@gird/core';
import type {
  ServerType,
  ServerStatus,
  CreateServerRequest,
  UpdateServerRequest,
  ServerResponse,
  DeploymentResponse,
} from '@gird/core';
import { NotFoundError, ValidationError } from '@gird/core';

const logger = createLogger('service:server');

export interface ServerFilters {
  type?: ServerType;
  status?: ServerStatus;
  search?: string;
}

export interface PaginationOptions {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ServerWithDeploymentsResponse extends ServerResponse {
  config: Record<string, unknown> | null;
  deployments?: DeploymentResponse[];
  currentDeployment?: DeploymentResponse | null;
}

export interface ListServersOptions {
  includeDeployments?: boolean;
  filters?: ServerFilters;
  pagination?: PaginationOptions;
}

export interface PaginatedServersResult {
  items: ServerResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export class ServerService {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrisma();
  }

  /**
   * List all servers with optional filtering and pagination
   */
  async list(options: ListServersOptions = {}): Promise<PaginatedServersResult> {
    const { filters = {}, includeDeployments = true, pagination } = options;

    const where: Record<string, unknown> = {};
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // If pagination is requested, use it; otherwise return all results
    if (pagination) {
      const { page, pageSize, sortBy = 'createdAt', sortOrder = 'desc' } = pagination;

      const [total, servers] = await Promise.all([
        this.prisma.server.count({ where }),
        this.prisma.server.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { [sortBy]: sortOrder },
          include: {
            deployments: includeDeployments
              ? { orderBy: { createdAt: 'desc' }, take: 1 }
              : false,
          },
        }),
      ]);

      const totalPages = Math.ceil(total / pageSize);

      return {
        items: servers.map((s) => this.toListResponse(s, includeDeployments)),
        total,
        page,
        pageSize,
        totalPages,
      };
    }

    // Non-paginated result
    const servers = await this.prisma.server.findMany({
      where,
      include: {
        deployments: includeDeployments
          ? { orderBy: { createdAt: 'desc' }, take: 1 }
          : false,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: servers.map((s) => this.toListResponse(s, includeDeployments)),
      total: servers.length,
      page: 1,
      pageSize: servers.length,
      totalPages: 1,
    };
  }

  /**
   * Find a server by ID with full details including deployments
   */
  async findById(id: string): Promise<ServerWithDeploymentsResponse> {
    const server = await this.prisma.server.findUnique({
      where: { id },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    return this.toDetailResponse(server);
  }

  /**
   * Find a server by ID without full details
   */
  async findBasicById(id: string): Promise<ServerResponse> {
    const server = await this.prisma.server.findUnique({
      where: { id },
    });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    return this.toResponse(server);
  }

  /**
   * Create a new server
   */
  async create(data: CreateServerRequest): Promise<ServerResponse> {
    await this.ensureNameAvailable(data.name);

    const server = await this.prisma.server.create({
      data: {
        name: data.name,
        type: data.type,
        config: (data.config ?? {}) as any,
        description: data.description ?? null,
      },
    });

    logger.info(`Created server: ${server.name} (${server.id})`);

    return this.toResponse(server);
  }

  /**
   * Update an existing server
   */
  async update(id: string, data: UpdateServerRequest): Promise<ServerResponse> {
    const server = await this.prisma.server.findUnique({ where: { id } });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    if (data.name && data.name !== server.name) {
      await this.ensureNameAvailable(data.name, id);
    }

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.config !== undefined) {
      updateData.config = data.config as unknown;
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    const updated = await this.prisma.server.update({
      where: { id },
      data: updateData,
    });

    logger.info(`Updated server: ${updated.name} (${updated.id})`);

    return this.toResponse(updated);
  }

  /**
   * Delete a server
   */
  async delete(id: string): Promise<void> {
    const server = await this.prisma.server.findUnique({ where: { id } });

    if (!server) {
      throw new NotFoundError('Server', id);
    }

    await this.prisma.server.delete({ where: { id } });

    logger.info(`Deleted server: ${server.name} (${id})`);
  }

  /**
   * Check if a server name is available
   */
  async checkNameAvailable(name: string, excludeId?: string): Promise<boolean> {
    const existing = await this.prisma.server.findFirst({
      where: {
        name,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });

    return !existing;
  }

  /**
   * Get a server by name
   */
  async findByName(name: string): Promise<ServerResponse | null> {
    const server = await this.prisma.server.findUnique({
      where: { name },
    });

    if (!server) {
      return null;
    }

    return this.toResponse(server);
  }

  /**
   * Ensure a server name is available, throw if not
   */
  private async ensureNameAvailable(
    name: string,
    excludeId?: string
  ): Promise<void> {
    if (!(await this.checkNameAvailable(name, excludeId))) {
      throw new ValidationError(`Server with name '${name}' already exists`);
    }
  }

  /**
   * Convert server to list response format
   */
  private toListResponse(
    server: any & { deployments?: any[] },
    includeDeployment: boolean = true
  ): ServerResponse {
    const base = {
      id: server.id,
      name: server.name,
      type: server.type as ServerType,
      status: server.status as ServerStatus,
      description: server.description,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    };

    if (includeDeployment && server.deployments && server.deployments.length > 0) {
      const deployment = server.deployments[0];
      return {
        ...base,
        currentDeployment: {
          id: deployment.id,
          type: deployment.type,
          status: deployment.status,
          port: deployment.port,
          host: deployment.host,
          containerId: deployment.containerId,
          pid: deployment.pid,
          createdAt: deployment.createdAt.toISOString(),
          updatedAt: deployment.updatedAt.toISOString(),
        },
      } as any;
    }

    return base;
  }

  /**
   * Convert server to basic response format
   */
  private toResponse(server: any): ServerResponse {
    return {
      id: server.id,
      name: server.name,
      type: server.type as ServerType,
      status: server.status as ServerStatus,
      description: server.description,
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    };
  }

  /**
   * Convert server to detailed response format with deployments
   */
  private toDetailResponse(
    server: any & { deployments: any[] }
  ): ServerWithDeploymentsResponse {
    return {
      id: server.id,
      name: server.name,
      type: server.type as ServerType,
      status: server.status as ServerStatus,
      description: server.description,
      config: (server.config as Record<string, unknown> | null) ?? null,
      deployments: server.deployments.map((d: any) => ({
        id: d.id,
        serverId: d.serverId,
        type: d.type,
        status: d.status,
        port: d.port,
        host: d.host,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      })),
      createdAt: server.createdAt.toISOString(),
      updatedAt: server.updatedAt.toISOString(),
    };
  }
}
