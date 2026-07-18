import { randomBytes, createHash } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, IsNull, Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { SyncService } from '@/modules/sync/sync.service';
import { UserService } from '@/modules/user/user.service';
import { RbacService } from '@/modules/rbac/rbac.service';
import type {
  CreatePermissionDto,
  CreateRoleDto,
  UpdatePermissionDto,
  UpdateRoleDto,
} from '@/modules/rbac/dto/rbac.dto';
import type { UserEntity } from '@/modules/user/entities/user.entity';
import type { SyncAccountDto } from '@/modules/sync/dto/sync-accounts.dto';
import type { SyncProviderDto } from '@/modules/sync/dto/sync-providers.dto';
import type { CreateAdminUserDto, ListAdminUsersQueryDto, UpdateAdminUserDto } from './dto/admin-user.dto';
import type {
  ChangeSystemAccountBindingsDto,
  CreateApprovalRequestDto,
  CreateSystemAccountDto,
  CreateInvitationDto,
  ListAuditLogsQueryDto,
  ListSystemAccountsQueryDto,
  PageQueryDto,
  ReviewApprovalRequestDto,
  UpdateAdminSyncedAccountDto,
  UpdateOwnSyncedAccountDto,
  UpdateSystemAccountDto,
} from './dto/admin-management.dto';
import { AdminApprovalRequestEntity } from './entities/admin-approval-request.entity';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';
import { AdminInvitationEntity } from './entities/admin-invitation.entity';

export interface InvitationForRegistration {
  id: string;
  email?: string | null;
  role: UserEntity['role'];
}

export type AdminSyncedProviderDto = Omit<SyncProviderDto, 'apiKey'> & {
  hasApiKey: boolean;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly users: UserService,
    private readonly sync: SyncService,
    private readonly rbac: RbacService,
    @InjectRepository(AdminAuditLogEntity)
    private readonly auditLogs: Repository<AdminAuditLogEntity>,
    @InjectRepository(AdminInvitationEntity)
    private readonly invitations: Repository<AdminInvitationEntity>,
    @InjectRepository(AdminApprovalRequestEntity)
    private readonly approvalRequests: Repository<AdminApprovalRequestEntity>,
  ) {}

  listUsers(query: ListAdminUsersQueryDto) {
    return this.users.listUsers(query);
  }

  async createUser(actor: AuthUser, dto: CreateAdminUserDto) {
    await this.rbac.assertRoleAssignable(actor, dto.role ?? 'user');
    const user = await this.users.createUser(dto);
    await this.record(actor, 'user.create', 'user', user.id, user.email, { role: user.role });
    return user;
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateAdminUserDto) {
    if (dto.role) await this.rbac.assertRoleAssignable(actor, dto.role);
    const user = await this.users.updateUser(id, dto);
    await this.record(actor, 'user.update', 'user', user.id, user.email, {
      fields: Object.keys(dto).filter((key) => key !== 'password'),
      passwordChanged: dto.password !== undefined,
    });
    return user;
  }

  async deleteUser(actor: AuthUser, id: string) {
    if (actor.id === id) throw new BadRequestException('You cannot delete your own account');
    const deleted = await this.users.deleteUser(id);
    await this.record(actor, 'user.delete', 'user', id, deleted.email);
    return deleted;
  }

  async changePassword(actor: AuthUser, currentPassword: string, newPassword: string) {
    const result = await this.users.changePassword(actor.id, currentPassword, newPassword);
    await this.record(actor, 'profile.password.change', 'user', actor.id, actor.email);
    return result;
  }

  listOwnAccounts(actor: AuthUser) {
    return this.sync.listForPortal(actor.id);
  }

  async updateOwnAccount(
    actor: AuthUser,
    accountId: string,
    dto: UpdateOwnSyncedAccountDto,
  ) {
    const account = await this.sync.updateForAdmin(actor.id, accountId, dto);
    await this.record(actor, 'sync-account.update', 'sync-account', accountId, account.email, {
      ownerId: actor.id,
      fields: Object.keys(dto),
    });
    return account;
  }

  async listUserAccounts(ownerId: string) {
    await this.ensureUser(ownerId);
    return this.sync.listForAdmin(ownerId);
  }

  async listUserProviders(ownerId: string): Promise<{ providers: AdminSyncedProviderDto[] }> {
    await this.ensureUser(ownerId);
    const data = await this.sync.listProviders(ownerId);
    return {
      providers: data.providers.map((provider) => this.presentSyncedProvider(provider)),
    };
  }

  async updateUserAccount(
    actor: AuthUser,
    ownerId: string,
    accountId: string,
    dto: UpdateAdminSyncedAccountDto,
  ) {
    await this.ensureUser(ownerId);
    const account = await this.sync.updateForAdmin(ownerId, accountId, dto as Partial<SyncAccountDto>);
    await this.record(actor, 'sync-account.update', 'sync-account', accountId, account.email, {
      ownerId,
      fields: Object.keys(dto),
    });
    return account;
  }

  async deleteUserAccount(actor: AuthUser, ownerId: string, accountId: string) {
    await this.ensureUser(ownerId);
    const result = await this.sync.delete(ownerId, accountId);
    await this.record(actor, 'sync-account.delete', 'sync-account', accountId, null, { ownerId });
    return result;
  }

  listSystemAccounts(query: ListSystemAccountsQueryDto) {
    const { page, pageSize } = this.page(query);
    return this.sync.listSystemAccounts(page, pageSize, query.search);
  }

  async createSystemAccount(actor: AuthUser, dto: CreateSystemAccountDto) {
    const account = await this.sync.createSystemAccount(dto);
    await this.record(actor, 'official-account.create', 'official-account', account.id, account.email, {
      syncAccountId: account.syncAccountId,
    });
    return account;
  }

  async addUserAccountToSystemPool(actor: AuthUser, ownerId: string, accountId: string) {
    const owner = await this.ensureUser(ownerId);
    const account = await this.sync.createSystemAccountFromPersonal(ownerId, accountId);
    await this.record(actor, 'official-account.create-from-user', 'official-account', account.id, account.email, {
      syncAccountId: account.syncAccountId,
      sourceOwnerId: owner.id,
      sourceOwnerEmail: owner.email,
      sourceAccountId: accountId,
    });
    return account;
  }

  async updateSystemAccount(actor: AuthUser, id: string, dto: UpdateSystemAccountDto) {
    const account = await this.sync.updateSystemAccount(id, dto);
    await this.record(actor, 'official-account.update', 'official-account', id, account.email, {
      fields: Object.keys(dto),
      authChanged: dto.auth !== undefined,
    });
    return account;
  }

  async deleteSystemAccount(actor: AuthUser, id: string) {
    const result = await this.sync.deleteSystemAccount(id);
    await this.record(actor, 'official-account.delete', 'official-account', id);
    return result;
  }

  listSystemAccountBindings(id: string) {
    return this.sync.listSystemAccountBindingIds(id);
  }

  async bindSystemAccounts(actor: AuthUser, dto: ChangeSystemAccountBindingsDto) {
    await this.ensureUsers(dto.userIds);
    const result = await this.sync.bindSystemAccounts(dto.systemAccountIds, dto.userIds);
    await this.record(actor, 'official-account.bind', 'official-account', null, null, {
      systemAccountIds: dto.systemAccountIds,
      userIds: dto.userIds,
      createdBindings: result.count,
    });
    return result;
  }

  async unbindSystemAccounts(actor: AuthUser, dto: ChangeSystemAccountBindingsDto) {
    await this.ensureUsers(dto.userIds);
    const result = await this.sync.unbindSystemAccounts(dto.systemAccountIds, dto.userIds);
    await this.record(actor, 'official-account.unbind', 'official-account', null, null, {
      systemAccountIds: dto.systemAccountIds,
      userIds: dto.userIds,
      removedBindings: result.count,
    });
    return result;
  }

  async listAuditLogs(query: ListAuditLogsQueryDto) {
    const { page, pageSize } = this.page(query);
    const search = query.search?.trim();
    const base = {
      ...(query.action ? { action: query.action } : {}),
    };
    const where = search
      ? [
        { ...base, actorEmail: ILike(`%${search}%`) },
        { ...base, targetEmail: ILike(`%${search}%`) },
        { ...base, action: ILike(`%${search}%`) },
      ]
      : base;
    const [items, total] = await this.auditLogs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async createInvitation(actor: AuthUser, dto: CreateInvitationDto) {
    await this.rbac.assertRoleAssignable(actor, dto.role ?? 'user');
    const token = randomBytes(24).toString('base64url');
    const invitation = this.invitations.create({
      email: dto.email?.trim().toLowerCase() || null,
      role: dto.role ?? 'user',
      tokenHash: this.hashToken(token),
      createdById: actor.id,
      createdByEmail: actor.email,
      maxUses: dto.maxUses ?? 1,
      usedCount: 0,
      expiresAt: dto.neverExpires
        ? null
        : new Date(Date.now() + Number(dto.expiresInHours ?? 72) * 60 * 60 * 1000),
    });
    const saved = await this.invitations.save(invitation);
    await this.record(actor, 'invitation.create', 'invitation', saved.id, saved.email, {
      role: saved.role,
      expiresAt: saved.expiresAt,
      maxUses: saved.maxUses,
    });
    return { ...this.presentInvitation(saved), token };
  }

  async listInvitations(query: PageQueryDto) {
    const { page, pageSize } = this.page(query);
    const [items, total] = await this.invitations.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: items.map((item) => this.presentInvitation(item)), total, page, pageSize };
  }

  async revokeInvitation(actor: AuthUser, id: string) {
    const invitation = await this.invitations.findOne({ where: { id } });
    if (!invitation) throw new NotFoundException('Invitation not found');
    invitation.revokedAt = new Date();
    const saved = await this.invitations.save(invitation);
    await this.record(actor, 'invitation.revoke', 'invitation', id, saved.email);
    return this.presentInvitation(saved);
  }

  async validateInvitation(
    token: string,
    email: string,
    manager?: EntityManager,
  ): Promise<InvitationForRegistration> {
    const invitations = manager?.getRepository(AdminInvitationEntity) ?? this.invitations;
    const invitation = await invitations.findOne({
      where: {
        tokenHash: this.hashToken(token),
        revokedAt: IsNull(),
      },
      ...(manager ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    const normalizedEmail = email.trim().toLowerCase();
    if (
      !invitation
      || (invitation.expiresAt && invitation.expiresAt <= new Date())
      || (invitation.email && invitation.email !== normalizedEmail)
      || invitation.usedCount >= invitation.maxUses
    ) {
      throw new BadRequestException('Invitation is invalid or expired');
    }
    return { id: invitation.id, email: invitation.email, role: invitation.role };
  }

  async acceptInvitation(invitationId: string, user: UserEntity, manager?: EntityManager) {
    const invitations = manager?.getRepository(AdminInvitationEntity) ?? this.invitations;
    const auditLogs = manager?.getRepository(AdminAuditLogEntity) ?? this.auditLogs;
    const invitation = await invitations.findOne({ where: { id: invitationId } });
    if (!invitation || invitation.usedCount >= invitation.maxUses) {
      throw new BadRequestException('Invitation has no remaining uses');
    }
    invitation.usedCount += 1;
    invitation.acceptedAt = new Date();
    invitation.acceptedById = user.id;
    await invitations.save(invitation);
    await auditLogs.save(auditLogs.create({
      actorId: user.id,
      actorEmail: user.email,
      action: 'invitation.accept',
      targetType: 'invitation',
      targetId: invitation.id,
      targetEmail: invitation.email,
      metadata: {
        role: invitation.role,
        usedCount: invitation.usedCount,
        maxUses: invitation.maxUses,
      },
    }));
  }

  async listApprovalRequests(query: PageQueryDto) {
    const { page, pageSize } = this.page(query);
    const [items, total] = await this.approvalRequests.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async createApprovalRequest(actor: AuthUser, dto: CreateApprovalRequestDto) {
    const target = await this.ensureUser(dto.targetUserId);
    if (target.role === 'admin') throw new BadRequestException('User is already an admin');
    const request = this.approvalRequests.create({
      type: dto.type,
      requestedById: actor.id,
      requestedByEmail: actor.email,
      targetUserId: target.id,
      targetEmail: target.email,
      payload: { role: 'admin' },
      comment: dto.comment ?? '',
    });
    const saved = await this.approvalRequests.save(request);
    await this.record(actor, 'approval.request', 'approval', saved.id, target.email, {
      type: saved.type,
      targetUserId: target.id,
    });
    return saved;
  }

  async reviewApprovalRequest(actor: AuthUser, id: string, dto: ReviewApprovalRequestDto) {
    const request = await this.approvalRequests.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Approval request not found');
    if (request.status !== 'pending') throw new BadRequestException('Approval request is already closed');
    if (request.requestedById === actor.id) {
      throw new BadRequestException('A different admin must review this request');
    }
    if (dto.decision === 'approved' && request.type === 'promote_user_to_admin') {
      await this.rbac.assertRoleAssignable(actor, 'admin');
      await this.users.updateUser(request.targetUserId, { role: 'admin' });
    }
    request.status = dto.decision;
    request.reviewedById = actor.id;
    request.reviewedByEmail = actor.email;
    request.reviewComment = dto.comment ?? '';
    request.reviewedAt = new Date();
    const saved = await this.approvalRequests.save(request);
    await this.record(actor, `approval.${dto.decision}`, 'approval', id, request.targetEmail, {
      type: request.type,
      targetUserId: request.targetUserId,
    });
    return saved;
  }

  listRoles() {
    return this.rbac.listRoles();
  }

  listPermissions() {
    return this.rbac.listPermissions();
  }

  async createPermission(actor: AuthUser, dto: CreatePermissionDto) {
    const permission = await this.rbac.createPermission(dto);
    await this.record(actor, 'permission.create', 'permission', permission.code, null, {
      name: permission.name,
      group: permission.group,
    });
    return permission;
  }

  async updatePermission(actor: AuthUser, code: string, dto: UpdatePermissionDto) {
    const permission = await this.rbac.updatePermission(code, dto);
    await this.record(actor, 'permission.update', 'permission', code, null, {
      fields: Object.keys(dto),
    });
    return permission;
  }

  async createRole(actor: AuthUser, dto: CreateRoleDto) {
    const role = await this.rbac.createRole(actor, dto);
    await this.record(actor, 'role.create', 'role', role.code, null, {
      name: role.name,
      permissions: role.permissions,
    });
    return role;
  }

  async updateRole(actor: AuthUser, code: string, dto: UpdateRoleDto) {
    const role = await this.rbac.updateRole(actor, code, dto);
    await this.record(actor, 'role.update', 'role', code, null, {
      fields: Object.keys(dto),
      permissions: role.permissions,
    });
    return role;
  }

  async deleteRole(actor: AuthUser, code: string) {
    const result = await this.rbac.deleteRole(code);
    await this.record(actor, 'role.delete', 'role', code);
    return result;
  }

  private async ensureUser(id: string) {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async ensureUsers(ids: string[]) {
    await Promise.all([...new Set(ids)].map((id) => this.ensureUser(id)));
  }

  private async record(
    actor: AuthUser,
    action: string,
    targetType: string,
    targetId?: string | null,
    targetEmail?: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    await this.auditLogs.save(this.auditLogs.create({
      actorId: actor.id,
      actorEmail: actor.email,
      action,
      targetType,
      targetId,
      targetEmail,
      metadata,
    }));
  }

  private page(query: PageQueryDto) {
    return {
      page: Math.max(1, Number(query.page ?? 1)),
      pageSize: Math.min(100, Math.max(1, Number(query.pageSize ?? 20))),
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private presentInvitation(invitation: AdminInvitationEntity) {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      createdByEmail: invitation.createdByEmail,
      expiresAt: invitation.expiresAt,
      maxUses: invitation.maxUses,
      usedCount: invitation.usedCount,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
    };
  }

  private presentSyncedProvider(provider: SyncProviderDto): AdminSyncedProviderDto {
    const { apiKey, ...safeProvider } = provider;
    return {
      ...safeProvider,
      hasApiKey: Boolean(apiKey?.trim()),
    };
  }
}
