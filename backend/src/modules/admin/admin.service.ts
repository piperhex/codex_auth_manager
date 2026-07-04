import { randomBytes, createHash } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Repository } from 'typeorm';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { SyncService } from '@/modules/sync/sync.service';
import { UserService } from '@/modules/user/user.service';
import type { UserEntity } from '@/modules/user/entities/user.entity';
import type { SyncAccountDto } from '@/modules/sync/dto/sync-accounts.dto';
import type { CreateAdminUserDto, ListAdminUsersQueryDto, UpdateAdminUserDto } from './dto/admin-user.dto';
import type {
  CreateApprovalRequestDto,
  CreateInvitationDto,
  ListAuditLogsQueryDto,
  PageQueryDto,
  ReviewApprovalRequestDto,
  UpdateAdminSyncedAccountDto,
} from './dto/admin-management.dto';
import { AdminApprovalRequestEntity } from './entities/admin-approval-request.entity';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';
import { AdminInvitationEntity } from './entities/admin-invitation.entity';

export interface InvitationForRegistration {
  id: string;
  email: string;
  role: UserEntity['role'];
}

@Injectable()
export class AdminService {
  constructor(
    private readonly users: UserService,
    private readonly sync: SyncService,
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
    const user = await this.users.createUser(dto);
    await this.record(actor, 'user.create', 'user', user.id, user.email, { role: user.role });
    return user;
  }

  async updateUser(actor: AuthUser, id: string, dto: UpdateAdminUserDto) {
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

  async listUserAccounts(ownerId: string) {
    await this.ensureUser(ownerId);
    return this.sync.list(ownerId);
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
    const token = randomBytes(24).toString('base64url');
    const invitation = this.invitations.create({
      email: dto.email.trim().toLowerCase(),
      role: dto.role ?? 'user',
      tokenHash: this.hashToken(token),
      createdById: actor.id,
      createdByEmail: actor.email,
      expiresAt: new Date(Date.now() + Number(dto.expiresInHours ?? 72) * 60 * 60 * 1000),
    });
    const saved = await this.invitations.save(invitation);
    await this.record(actor, 'invitation.create', 'invitation', saved.id, saved.email, {
      role: saved.role,
      expiresAt: saved.expiresAt,
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

  async validateInvitation(token: string, email: string): Promise<InvitationForRegistration> {
    const invitation = await this.invitations.findOne({
      where: {
        tokenHash: this.hashToken(token),
        acceptedAt: IsNull(),
        revokedAt: IsNull(),
      },
    });
    const normalizedEmail = email.trim().toLowerCase();
    if (!invitation || invitation.expiresAt <= new Date() || invitation.email !== normalizedEmail) {
      throw new BadRequestException('Invitation is invalid or expired');
    }
    return { id: invitation.id, email: invitation.email, role: invitation.role };
  }

  async acceptInvitation(invitationId: string, user: UserEntity) {
    const invitation = await this.invitations.findOne({ where: { id: invitationId } });
    if (!invitation || invitation.acceptedAt) return;
    invitation.acceptedAt = new Date();
    invitation.acceptedById = user.id;
    await this.invitations.save(invitation);
    await this.auditLogs.save(this.auditLogs.create({
      actorId: user.id,
      actorEmail: user.email,
      action: 'invitation.accept',
      targetType: 'invitation',
      targetId: invitation.id,
      targetEmail: invitation.email,
      metadata: { role: invitation.role },
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

  private async ensureUser(id: string) {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
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
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
    };
  }
}
