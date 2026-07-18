import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from '@/modules/admin/admin.service';
import type { AdminApprovalRequestEntity } from '@/modules/admin/entities/admin-approval-request.entity';
import type { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import type { AdminInvitationEntity } from '@/modules/admin/entities/admin-invitation.entity';
import type { SyncService } from '@/modules/sync/sync.service';
import type { UserService } from '@/modules/user/user.service';
import type { RbacService } from '@/modules/rbac/rbac.service';
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
    listForPortal: ReturnType<typeof vi.fn>;
    createSystemAccount: ReturnType<typeof vi.fn>; createSystemAccountFromPersonal: ReturnType<typeof vi.fn>;
    updateSystemAccount: ReturnType<typeof vi.fn>;
    deleteSystemAccount: ReturnType<typeof vi.fn>; listSystemAccountBindingIds: ReturnType<typeof vi.fn>;
    bindSystemAccounts: ReturnType<typeof vi.fn>; unbindSystemAccounts: ReturnType<typeof vi.fn>;
    countSystemAccountBindingsByUserIds: ReturnType<typeof vi.fn>;
  };
  let rbac: {
    assertRoleAssignable: ReturnType<typeof vi.fn>;
    listRoles: ReturnType<typeof vi.fn>;
    listPermissions: ReturnType<typeof vi.fn>;
    createRole: ReturnType<typeof vi.fn>;
    updateRole: ReturnType<typeof vi.fn>;
    deleteRole: ReturnType<typeof vi.fn>;
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
      createSystemAccountFromPersonal: vi.fn(),
      listForPortal: vi.fn(),
      updateSystemAccount: vi.fn(), deleteSystemAccount: vi.fn(),
      listSystemAccountBindingIds: vi.fn(), bindSystemAccounts: vi.fn(),
      unbindSystemAccounts: vi.fn(),
      countSystemAccountBindingsByUserIds: vi.fn().mockResolvedValue(new Map()),
    };
    rbac = {
      assertRoleAssignable: vi.fn().mockResolvedValue({ code: 'user' }),
      listRoles: vi.fn(),
      listPermissions: vi.fn(),
      createRole: vi.fn(),
      updateRole: vi.fn(),
      deleteRole: vi.fn(),
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
      rbac as unknown as RbacService,
      auditLogs as unknown as Repository<AdminAuditLogEntity>,
      invitations as unknown as Repository<AdminInvitationEntity>,
      approvals as unknown as Repository<AdminApprovalRequestEntity>,
      { KONG_JWT_SECRET: 'test-invitation-secret' },
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
    expect(stored.maxUses).toBe(1);
    expect(stored.usedCount).toBe(0);
    await expect(service.getInvitationToken(stored.id))
      .resolves.toEqual({ token: created.token });
    await expect(service.validateInvitation(created.token!, 'invite@example.com'))
      .resolves.toMatchObject({ id: 'invitation-1', role: 'admin' });

    const acceptedUser = makeUser({ id: 'user-2', email: 'invite@example.com', role: 'admin' });
    await service.acceptInvitation('invitation-1', acceptedUser);
    expect(stored.usedCount).toBe(1);
    expect(stored.acceptedById).toBe(acceptedUser.id);
    expect(stored.acceptedAt).toBeInstanceOf(Date);
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'invitation.accept',
      actorId: acceptedUser.id,
    }));
  });

  it('copies a signed link for legacy invitations without invalidating their old token', async () => {
    const invitation = {
      id: 'legacy-invitation',
      email: 'legacy@example.com',
      tokenHash: 'legacy-random-token-hash',
    } as AdminInvitationEntity;
    invitations.findOne.mockResolvedValue(invitation);

    const result = await service.getInvitationToken(invitation.id);

    expect(result.token).toEqual(expect.any(String));
    expect(invitation.tokenHash).toBe('legacy-random-token-hash');
    expect(invitations.save).not.toHaveBeenCalled();
    await expect(service.validateInvitation(result.token, invitation.email!))
      .resolves.toMatchObject({ id: invitation.id });
  });

  it('supports reusable invitations without an email or expiration date', async () => {
    const created = await service.createInvitation(actor, {
      role: 'user',
      maxUses: 2,
      neverExpires: true,
    });
    const stored = invitations.save.mock.calls[0][0] as AdminInvitationEntity;
    invitations.findOne.mockResolvedValue(stored);

    expect(stored.email).toBeNull();
    expect(stored.expiresAt).toBeNull();
    await expect(service.validateInvitation(created.token!, 'first@example.com')).resolves.toBeTruthy();
    await service.acceptInvitation('invitation-1', makeUser({ id: 'user-2', email: 'first@example.com' }));
    await expect(service.validateInvitation(created.token!, 'second@example.com')).resolves.toBeTruthy();
    await service.acceptInvitation('invitation-1', makeUser({ id: 'user-3', email: 'second@example.com' }));

    expect(stored.usedCount).toBe(2);
    await expect(service.validateInvitation(created.token!, 'third@example.com'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists every user registered through an invitation', async () => {
    const invitation = { id: 'invitation-1', role: 'user' } as AdminInvitationEntity;
    invitations.findOne.mockResolvedValue(invitation);
    auditLogs.findAndCount.mockResolvedValue([[
      {
        id: 'audit-2',
        actorId: 'user-3',
        actorEmail: 'second@example.com',
        action: 'invitation.accept',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: { role: 'admin' },
        createdAt: new Date('2026-07-04T02:00:00.000Z'),
      },
      {
        id: 'audit-1',
        actorId: 'user-2',
        actorEmail: 'first@example.com',
        action: 'invitation.accept',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: {},
        createdAt: new Date('2026-07-04T01:00:00.000Z'),
      },
    ], 2]);
    sync.countSystemAccountBindingsByUserIds.mockResolvedValue(new Map([
      ['user-3', 2],
      ['user-2', 1],
    ]));

    await expect(service.listInvitationUsers(invitation.id, { page: 1, pageSize: 20 }))
      .resolves.toEqual({
        items: [
          expect.objectContaining({
            id: 'audit-2', userId: 'user-3', email: 'second@example.com', role: 'admin',
            giftedAccountCount: 2,
          }),
          expect.objectContaining({
            id: 'audit-1', userId: 'user-2', email: 'first@example.com', role: 'user',
            giftedAccountCount: 1,
          }),
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
    expect(auditLogs.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        action: 'invitation.accept',
        targetType: 'invitation',
        targetId: invitation.id,
      },
    }));
    expect(sync.countSystemAccountBindingsByUserIds)
      .toHaveBeenCalledWith(['user-3', 'user-2']);
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

  it('lists the current user accounts through the credential-safe portal projection', async () => {
    const result = { accounts: [{ id: 'account-1', email: 'self@example.com' }] };
    sync.listForPortal.mockResolvedValue(result);

    await expect(service.listOwnAccounts(actor)).resolves.toBe(result);
    expect(sync.listForPortal).toHaveBeenCalledWith(actor.id);
  });

  it('updates current-user account metadata and records an audit log', async () => {
    const account = { id: 'account-1', email: 'self@example.com' };
    const dto = { note: 'Personal note', expiresAt: '2026-07-31' };
    sync.updateForAdmin.mockResolvedValue(account);

    await expect(service.updateOwnAccount(actor, account.id, dto)).resolves.toBe(account);

    expect(sync.updateForAdmin).toHaveBeenCalledWith(actor.id, account.id, dto);
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sync-account.update',
      targetId: account.id,
      metadata: { ownerId: actor.id, fields: ['note', 'expiresAt'] },
    }));
  });

  it('adds an existing user account to the official pool and records its source', async () => {
    const owner = makeUser({ id: 'owner-1', email: 'owner@example.com' });
    const pooled = {
      id: 'system-account-1',
      syncAccountId: 'sync-account-1',
      email: 'official@example.com',
    };
    users.findById.mockResolvedValue(owner);
    sync.createSystemAccountFromPersonal.mockResolvedValue(pooled);

    await expect(service.addUserAccountToSystemPool(actor, owner.id, 'personal-account-1'))
      .resolves.toBe(pooled);

    expect(sync.createSystemAccountFromPersonal)
      .toHaveBeenCalledWith(owner.id, 'personal-account-1');
    expect(auditLogs.save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'official-account.create-from-user',
      targetId: pooled.id,
      targetEmail: pooled.email,
      metadata: {
        syncAccountId: pooled.syncAccountId,
        sourceOwnerId: owner.id,
        sourceOwnerEmail: owner.email,
        sourceAccountId: 'personal-account-1',
      },
    }));
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
