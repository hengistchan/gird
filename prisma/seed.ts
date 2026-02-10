import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient({
  log: ['error', 'warn'],
});

/**
 * Helper to convert RolePermission to Prisma InputJsonValue
 */
function toPermissionsJson(permissions: RolePermission): Prisma.InputJsonValue {
  return permissions as unknown as Prisma.InputJsonValue;
}

/**
 * RolePermission interface
 * Matches the structure used in the Role model's permissions JSON field
 */
interface RolePermission {
  servers: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean };
  apiKeys: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean };
  users: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean; manageRoles?: boolean };
  tenants: { read?: boolean; update?: boolean; manageQuota?: boolean };
  webhooks: { create?: boolean; read?: boolean; update?: boolean; delete?: boolean };
}

/**
 * Default roles to seed
 */
const DEFAULT_ROLES: Array<{ name: string; description: string; permissions: RolePermission }> = [
  {
    name: 'ADMIN',
    description: 'Full administrative access to all resources',
    permissions: {
      servers: { create: true, read: true, update: true, delete: true },
      apiKeys: { create: true, read: true, update: true, delete: true },
      users: { create: true, read: true, update: true, delete: true, manageRoles: true },
      tenants: { read: true, update: true, manageQuota: true },
      webhooks: { create: true, read: true, update: true, delete: true },
    },
  },
  {
    name: 'USER',
    description: 'Standard user with limited permissions',
    permissions: {
      servers: { create: true, read: true, update: true, delete: false },
      apiKeys: { create: true, read: true, update: true, delete: true },
      users: { create: false, read: true, update: false, delete: false, manageRoles: false },
      tenants: { read: true, update: false, manageQuota: false },
      webhooks: { create: true, read: true, update: true, delete: true },
    },
  },
  {
    name: 'READ_ONLY',
    description: 'Read-only access to view resources',
    permissions: {
      servers: { create: false, read: true, update: false, delete: false },
      apiKeys: { create: false, read: true, update: false, delete: false },
      users: { create: false, read: true, update: false, delete: false, manageRoles: false },
      tenants: { read: true, update: false, manageQuota: false },
      webhooks: { create: false, read: true, update: false, delete: false },
    },
  },
];

async function main() {
  console.log('Starting database seed...');

  // Create default roles
  for (const roleData of DEFAULT_ROLES) {
    const existingRole = await prisma.role.findUnique({
      where: { name: roleData.name },
    });

    if (!existingRole) {
      await prisma.role.create({
        data: {
          name: roleData.name,
          description: roleData.description,
          isSystem: true,
          permissions: toPermissionsJson(roleData.permissions),
        },
      });
      console.log(`Created role: ${roleData.name}`);
    } else {
      console.log(`Role already exists: ${roleData.name}`);
    }
  }

  console.log('Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
