/**
 * API Key Service - Business logic for API key management
 */

import { getPrisma, createLogger, generateApiKey, hashApiKey, extractApiKeyPrefix } from '@gird/core';
import type {
  CreateApiKeyRequest,
  ApiKeyResponse,
  ApiKeyPermissions,
} from '@gird/core';
import { NotFoundError } from '@gird/core';

const logger = createLogger('service:api-key');

export interface ApiKeyListOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ApiKeyListResponseItem {
  id: string;
  name: string;
  permissions: ApiKeyPermissions;
  keyPrefix?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedApiKeysResult {
  items: ApiKeyListResponseItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Type for the permissions stored in the database
type StoredPermissions = { serverIds: string[] | null } | null;

export class ApiKeyService {
  private prisma: ReturnType<typeof getPrisma>;

  constructor() {
    this.prisma = getPrisma();
  }

  /**
   * List all API keys (without the actual key value)
   * Supports pagination and search
   */
  async list(options: ApiKeyListOptions = {}): Promise<PaginatedApiKeysResult> {
    const { search, page = 1, pageSize = 20 } = options;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { keyPrefix: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, keys] = await Promise.all([
      this.prisma.apiKey.count({ where }),
      this.prisma.apiKey.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      items: keys.map((k) => this.toListResponse(k)),
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  /**
   * Find an API key by ID
   */
  async findById(id: string): Promise<ApiKeyListResponseItem> {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!key) {
      throw new NotFoundError('API Key', id);
    }

    return this.toListResponse(key);
  }

  /**
   * Create a new API key
   * Returns the full key value (only shown on creation)
   */
  async create(data: CreateApiKeyRequest): Promise<ApiKeyResponse> {
    const apiKey = generateApiKey();
    const keyHash = await hashApiKey(apiKey);
    const keyPrefix = extractApiKeyPrefix(apiKey);

    // Handle the permissions field - convert to the format stored in database
    // If serverIds is undefined (user didn't specify), store null meaning "all servers"
    // If serverIds is explicitly null, also store null
    // Otherwise store the object with serverIds array
    const permissionsValue: StoredPermissions = { serverIds: data.permissions.serverIds ?? null };

    const key = await this.prisma.apiKey.create({
      data: {
        key: apiKey,
        keyPrefix,
        keyHash,
        name: data.name,
        permissions: permissionsValue,
      },
    });

    logger.info(`Created API key: ${key.name} (${key.id})`);

    return {
      id: key.id,
      name: key.name,
      key: apiKey,
      permissions: key.permissions as ApiKeyPermissions,
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
    };
  }

  /**
   * Delete an API key
   */
  async delete(id: string): Promise<void> {
    const existing = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError('API Key', id);
    }

    await this.prisma.apiKey.delete({
      where: { id },
    });

    logger.info(`Deleted API key: ${existing.name} (${id})`);
  }

  /**
   * Check if an API key name is available
   */
  async checkNameAvailable(name: string, excludeId?: string): Promise<boolean> {
    const existing = await this.prisma.apiKey.findFirst({
      where: {
        name,
        ...(excludeId && { id: { not: excludeId } }),
      },
    });

    return !existing;
  }

  /**
   * Convert API key to list response format (without the actual key)
   */
  private toListResponse(key: {
    id: string;
    name: string;
    permissions: unknown;
    keyPrefix: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ApiKeyListResponseItem {
    return {
      id: key.id,
      name: key.name,
      permissions: key.permissions as ApiKeyPermissions,
      keyPrefix: key.keyPrefix,
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
    };
  }
}
