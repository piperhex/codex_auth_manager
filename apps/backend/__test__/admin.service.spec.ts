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
import { makeUser } from './fixtures';

describe('AdminService', () => {
  const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };
  let users: {
    listUsers: ReturnType<typeof vi.fn>; createUser: ReturnType<typeof vi.fn>;
    updateUser: ReturnType<typeof vi.fn>; deleteUser: ReturnType<typeof vi.fn>;
    changePassword: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn>;
  };
  let sync: {
    list: ReturnType<typeof vi.fn>; updateForAdmin: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
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
    sync = { list: vi.fn(), updateForAdmin: vi.fn(), delete: vi.fn() };
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
      email: created.email, password: 'password', role: 'user',
    })).resolves.toBe(created);

    expect(users.createUser).toHaveBeenCalledWith({
      email: created.email, password: 'password', role: 'user',
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
