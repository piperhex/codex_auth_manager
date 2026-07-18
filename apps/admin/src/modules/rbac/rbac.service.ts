import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLE_CODES,
  USER_ROLE_PERMISSIONS,
  expandPermissionDependencies,
} from '@/common/rbac/permissions';
import type {
  CreatePermissionDto,
  CreateRoleDto,
  UpdatePermissionDto,
  UpdateRoleDto,
} from './dto/rbac.dto';
import { RbacPermissionEntity } from './entities/permission.entity';
import { RbacRoleEntity } from './entities/role.entity';

@Injectable()
export class RbacService implements OnModuleInit {
  constructor(
    @InjectRepository(RbacPermissionEntity)
    private readonly permissions: Repository<RbacPermissionEntity>,
    @InjectRepository(RbacRoleEntity)
    private readonly roles: Repository<RbacRoleEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.synchronizeCatalog();
  }

  async synchronizeCatalog() {
    await this.permissions.upsert(
      PERMISSION_CATALOG.map((permission) => ({ ...permission, system: true })),
      ['code'],
    );
    await this.ensureUserRole(
      SYSTEM_ROLE_CODES.user,
      'User',
      'Default self-service role.',
      [...USER_ROLE_PERMISSIONS],
    );
    const allPermissions = await this.permissions.find();
    await this.ensureSystemRole(
      SYSTEM_ROLE_CODES.admin,
      'Administrator',
      'Built-in role with every permission.',
      allPermissions.map((permission) => permission.code),
    );
  }

  async listPermissions() {
    return this.permissions.find({ order: { group: 'ASC', code: 'ASC' } });
  }

  async createPermission(dto: CreatePermissionDto) {
    const code = dto.code.trim().toLowerCase();
    const name = dto.name.trim();
    const group = dto.group.trim();
    if (!name || !group) throw new BadRequestException('Permission name and group are required');
    if (code.startsWith('admin.') || code.startsWith('self.')) {
      throw new BadRequestException('The admin.* and self.* permission namespaces are reserved');
    }
    if (await this.permissions.exists({ where: { code } })) {
      throw new BadRequestException('Permission code already exists');
    }
    const permission = await this.permissions.save(this.permissions.create({
      code,
      name,
      group,
      description: dto.description?.trim() ?? '',
      system: false,
    }));
    const adminRole = await this.roles.findOne({ where: { code: SYSTEM_ROLE_CODES.admin } });
    if (adminRole && !adminRole.permissions.some((item) => item.code === permission.code)) {
      adminRole.permissions = [...adminRole.permissions, permission];
      await this.roles.save(adminRole);
    }
    return permission;
  }

  async updatePermission(code: string, dto: UpdatePermissionDto) {
    const permission = await this.permissions.findOne({ where: { code } });
    if (!permission) throw new NotFoundException('Permission not found');
    if (permission.system) throw new BadRequestException('Built-in permissions cannot be modified');
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Permission name is required');
      permission.name = name;
    }
    if (dto.group !== undefined) {
      const group = dto.group.trim();
      if (!group) throw new BadRequestException('Permission group is required');
      permission.group = group;
    }
    if (dto.description !== undefined) permission.description = dto.description.trim();
    return this.permissions.save(permission);
  }

  async listRoles() {
    const roles = await this.roles.find({ order: { system: 'DESC', name: 'ASC' } });
    const counts = await this.dataSource.query<Array<{ role: string; count: string }>>(
      'SELECT role, COUNT(*)::text AS count FROM users GROUP BY role',
    );
    const countByRole = new Map(counts.map((row) => [row.role, Number(row.count)]));
    return roles.map((role) => this.presentRole(role, countByRole.get(role.code) ?? 0));
  }

  async findRole(code: string) {
    return this.roles.findOne({ where: { code } });
  }

  async getRole(code: string) {
    const role = await this.findRole(code);
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async accessForRole(code: string) {
    const role = await this.findRole(code);
    if (!role) return null;
    return {
      roleName: role.name,
      permissions: role.permissions.map((permission) => permission.code),
    };
  }

  async createRole(actor: AuthUser, dto: CreateRoleDto) {
    const code = dto.code.trim().toLowerCase();
    if (await this.roles.exists({ where: { code } })) {
      throw new BadRequestException('Role code already exists');
    }
    const permissions = await this.resolvePermissions(expandPermissionDependencies(dto.permissions));
    this.assertCanGrant(actor, permissions.map((permission) => permission.code));
    const role = this.roles.create({
      code,
      name: dto.name.trim(),
      description: dto.description?.trim() ?? '',
      system: false,
      permissions,
    });
    return this.presentRole(await this.roles.save(role), 0);
  }

  async updateRole(actor: AuthUser, code: string, dto: UpdateRoleDto) {
    const role = await this.getRole(code);
    if (role.system && role.code !== SYSTEM_ROLE_CODES.user) {
      throw new BadRequestException('Only the built-in user role can be modified');
    }
    if (dto.name !== undefined) role.name = dto.name.trim();
    if (dto.description !== undefined) role.description = dto.description.trim();
    if (dto.permissions !== undefined) {
      const permissions = await this.resolvePermissions(expandPermissionDependencies(dto.permissions));
      const existing = new Set(role.permissions.map((permission) => permission.code));
      this.assertCanGrant(
        actor,
        permissions
          .map((permission) => permission.code)
          .filter((permission) => !existing.has(permission)),
      );
      role.permissions = permissions;
    }
    const saved = await this.roles.save(role);
    const countRows = await this.dataSource.query<Array<{ count: string }>>(
      'SELECT COUNT(*)::text AS count FROM users WHERE role = $1',
      [code],
    );
    return this.presentRole(saved, Number(countRows[0]?.count ?? 0));
  }

  async deleteRole(code: string) {
    const role = await this.getRole(code);
    if (role.system) throw new BadRequestException('Built-in roles cannot be deleted');
    const assigned = await this.dataSource.query<Array<{ count: string }>>(
      `SELECT (
        (SELECT COUNT(*) FROM users WHERE role = $1)
        + (SELECT COUNT(*) FROM admin_invitations
           WHERE role = $1
             AND "revokedAt" IS NULL
             AND "usedCount" < "maxUses"
             AND ("expiresAt" IS NULL OR "expiresAt" > now()))
      )::text AS count`,
      [code],
    );
    if (Number(assigned[0]?.count ?? 0) > 0) {
      throw new BadRequestException('Role is assigned to a user or active invitation');
    }
    await this.roles.remove(role);
    return { code };
  }

  async assertRoleAssignable(actor: AuthUser, code: string) {
    const role = await this.getRole(code);
    if (role.code === SYSTEM_ROLE_CODES.user) return role;
    if (role.code === SYSTEM_ROLE_CODES.admin && actor.role !== SYSTEM_ROLE_CODES.admin) {
      throw new ForbiddenException('Only a built-in administrator can assign the administrator role');
    }
    this.assertCanGrant(actor, role.permissions.map((permission) => permission.code));
    return role;
  }

  private assertCanGrant(actor: AuthUser, permissions: string[]) {
    if (actor.role === SYSTEM_ROLE_CODES.admin) return;
    const granted = new Set(actor.permissions ?? []);
    if (permissions.some((permission) => !granted.has(permission))) {
      throw new ForbiddenException('You cannot grant permissions you do not have');
    }
  }

  private async resolvePermissions(codes: string[]) {
    const unique = [...new Set(codes)];
    if (!unique.length) return [];
    const permissions = await this.permissions.find({ where: { code: In(unique) } });
    if (permissions.length !== unique.length) {
      throw new BadRequestException('One or more permissions are invalid');
    }
    const byCode = new Map(permissions.map((permission) => [permission.code, permission]));
    return unique.map((code) => byCode.get(code)!);
  }

  private async ensureSystemRole(
    code: string,
    name: string,
    description: string,
    permissionCodes: string[],
  ) {
    const permissions = await this.resolvePermissions(permissionCodes);
    const existing = await this.roles.findOne({ where: { code } });
    const role = existing ?? this.roles.create({ code });
    role.name = name;
    role.description = description;
    role.system = true;
    role.permissions = permissions;
    await this.roles.save(role);
  }

  private async ensureUserRole(
    code: string,
    name: string,
    description: string,
    permissionCodes: string[],
  ) {
    const existing = await this.roles.findOne({ where: { code } });
    if (existing) {
      existing.system = true;
      await this.roles.save(existing);
      return;
    }
    await this.ensureSystemRole(code, name, description, permissionCodes);
  }

  private presentRole(role: RbacRoleEntity, userCount: number) {
    return {
      code: role.code,
      name: role.name,
      description: role.description,
      system: role.system,
      permissions: role.permissions.map((permission) => permission.code).sort(),
      userCount,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
