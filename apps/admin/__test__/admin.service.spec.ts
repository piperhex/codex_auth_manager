import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '@/modules/admin/admin.service';
import type { AdminApprovalRequestEntity } from '@/modules/admin/entities/admin-approval-request.entity';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type { AdminInvitationEntity } from '@/modules/admin/entities/admin-invitation.entity';
import type { SyncService } from '@/modules/sync/sync.service';
import type { UserService } from '@/modules/user/user.service';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { makeProvider, makeUser } from './fixtures';

describe('AdminService', () => {
  const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
  let users: {
    listUsers: ReturnType<typeof vi.fn>; createUser: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>; deleteUser: ReturnType<typeof vi.fn>;
    changePassword: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn>;
  };
  let sync: {
    list: ReturnType<typeof vi.fn>; updateForAdmin: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>; listProviders: ReturnType<typeof vi.fn>;
    listForAdmin: ReturnType<typeof vi.fn>; listSystemAccounts: ReturnType<typeof vi.fn>;
    createSystemAccount: ReturnType<typeof vi.fn>; updateSystemAccount: ReturnType<typeof vi.fn>;
    deleteSystemAccount: ReturnType<typeof vi.fn>; listSystemAccountBindingIds: ReturnType<typeof vi.fn>;
    bindSystemAccounts: ReturnType<typeof vi.fn>; unbindSystemAccounts: ReturnType<typeof vi.fn>;
  };
  let auditLogs: {
    create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>; findAndCount: ReturnType<typeof vi.fn>;
  };
  let invitations: {
    create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn>;
  };
  let approvals: {
    create: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn>;
  };
  let service: AdminService;

  beforeEach(() => {
    users = {
      listUsers: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(),
      deleteUser: vi.fn(), changePassword: vi.fn(), findById: vi.fn(),
    };
    sync = {
      list: vi.fn(), updateForAdmin: vi.fn(), delete: vi.fn(), listProviders: vi.fn(),
      listForAdmin: vi.fn(), listSystemAccounts: vi.fn(), createSystemAccount: vi.fn(),
      updateSystemAccount: vi.fn(), deleteSystemAccount: vi.fn(),
      listSystemAccountBindingIds: vi.fn(), bindSystemAccounts: vi.fn(),
      unbindSystemAccounts: vi.fn(),
    };
    auditLogs = {
      create: vi.fn((value) => value),
      save: vi.fn(async (value) => value),
      findAndCount: vi.fn(),
    };
    invitations = {
      create: vi.fn((value) => ({ id: 'invitation-1', createdAt: new Date(), updatedAt: new Date(), ...value })),
      save: vi.fn(async (value) => value),
      findAndCount: vi.fn(),
      findOne: vi.fn(),
    };
    approvals = {
      create: vi.fn((value) => ({ id: 'approval-1', status: 'pending', createdAt: new Date(), ...value })),
      save: vi.fn(async (value) => value),
      findAndCount: vi.fn(),
      findOne: vi.fn(),
    };
    service = new AdminService(
      users as unknown as UserService,
      sync as unknown as SyncService,
      auditLogs as unknown as Repository<AdminAuditLogEntity>,
      invitations as unknown as Repository<AdminInvitationEntity>,
      approvals as unknown as Repository<AdminApprovalRequestEntity>,
    );
  });

  it('creates users through UserService and writes an audit log', async () => {
    const created = makeUser({ id: 'user-2', email: 'new@example.com' });
    users.createUser.mockResolvedValue(created);

    await expect(service.createUser(actor, {
      email: created.email, password: 'password', role: 'user', disabled: true,
    })).resolves.toBe(created);

    expect(users.createUser).toHaveBeenCalledWith({
      email: created.email, password: 'password', role: 'user', disabled: true,
    });
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      actorId: actor.id,
      action: 'user.create',
      targetId: created.id,
      targetEmail: created.email,
    }));
  });

  it('creates, validates and accepts invitation tokens without storing the raw token', async () => {
    const created = await service.createInvitation(actor, {
      email: 'Invite@Example.COM',
      role: 'admin',
      expiresInHours: 2,
    });
    const stored = invitations.save.mock.calls[0][0] as AdminInvitationEntity;
    invitations.findOne.mockResolvedValue(stored);

    expect(created.email).toBe('invite@example.com');
    expect(created.token).toEqual(expect.any(String));
    expect(stored.tokenHash).not.toBe(created.token);
    await expect(service.validateInvitation(created.token!, 'invite@example.com'))
      .resolves.toMatchObject({ id: 'invitation-1', role: 'admin' });

    const acceptedUser = makeUser({ id: 'user-2', email: 'invite@example.com', role: 'admin' });
    await service.acceptInvitation('invitation-1', acceptedUser);
    expect(stored.acceptedById).toBe(acceptedUser.id);
    expect(stored.acceptedAt).toBeInstanceOf(Date);
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'invitation.accept',
      actorId: acceptedUser.id,
    }));
  });

  it('lists synced providers for an existing user without exposing API keys', async () => {
    const owner = makeUser({ id: 'owner-1' });
    const provider = makeProvider({ apiKey: 'sk-secret' });
    users.findById.mockResolvedValue(owner);
    sync.listProviders.mockResolvedValue({ providers: [provider] });

    await expect(service.listUserProviders(owner.id)).resolves.toEqual({
      providers: [{
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        model: provider.model,
        models: provider.models,
        modelSelectionControlledByCodex: provider.modelSelectionControlledByCodex,
        apiFormat: provider.apiFormat,
        lastModifiedAt: provider.lastModifiedAt,
        hasApiKey: true,
      }],
    });

    expect(users.findById).toHaveBeenCalledWith(owner.id);
    expect(sync.listProviders).toHaveBeenCalledWith(owner.id);
  });

  it('validates target users, binds official pool accounts, and records an audit log', async () => {
    const target = makeUser({ id: '20000000-0000-4000-8000-000000000001' });
    const dto = {
      systemAccountIds: ['10000000-0000-4000-8000-000000000001'],
      userIds: [target.id],
    };
    users.findById.mockResolvedValue(target);
    sync.bindSystemAccounts.mockResolvedValue({ count: 1 });

    await expect(service.bindSystemAccounts(actor, dto)).resolves.toEqual({ count: 1 });

    expect(users.findById).toHaveBeenCalledWith(target.id);
    expect(sync.bindSystemAccounts).toHaveBeenCalledWith(dto.systemAccountIds, dto.userIds);
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'official-account.bind',
      metadata: expect.objectContaining({ createdBindings: 1, userIds: dto.userIds }),
    }));
  });

  it('requires a different admin to approve privileged requests and applies approved changes', async () => {
    const target = makeUser({ id: 'user-2', email: 'target@example.com', role: 'user' });
    users.findById.mockResolvedValue(target);
    const request = await service.createApprovalRequest(actor, {
      type: 'promote_user_to_admin',
      targetUserId: target.id,
    });

    approvals.findOne.mockResolvedValue(request);
    await expect(service.reviewApprovalRequest(actor, request.id, { decision: 'approved' }))
      .rejects.toBeInstanceOf(BadRequestException);

    const reviewer: AuthUser = { id: 'admin-2', email: 'reviewer@example.com', role: 'admin' };
    await expect(service.reviewApprovalRequest(reviewer, request.id, { decision: 'approved' }))
      .resolves.toMatchObject({ status: 'approved', reviewedById: reviewer.id });
    expect(users.updateUser).toHaveBeenCalledWith(target.id, { role: 'admin' });
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'approval.approved',
      actorId: reviewer.id,
    }));
  });
});
