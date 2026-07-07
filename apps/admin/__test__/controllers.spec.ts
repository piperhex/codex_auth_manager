import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AdminController } from '@/modules/admin/admin.controller';
import type { AdminService } from '@/modules/admin/admin.service';
import { AuthController } from '@/modules/auth/auth.controller';
import { SyncController } from '@/modules/sync/sync.controller';
import type { AuthService } from '@/modules/auth/auth.service';
import type { SyncService } from '@/modules/sync/sync.service';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { makeAccount, makeProvider } from './fixtures';

describe('HTTP controllers', () => {
  it('AuthController forwards every endpoint argument and result', async () => {
    const auth = {
      register: vi.fn().mockResolvedValue('registered'),
      login: vi.fn().mockResolvedValue('logged-in'),
      refresh: vi.fn().mockResolvedValue('refreshed'),
      logout: vi.fn().mockResolvedValue({ ok: true }),
      me: vi.fn().mockResolvedValue('profile'),
    };
    const controller = new AuthController(auth as unknown as AuthService);

    await expect(controller.register({ email: 'a@example.com', password: 'password' }))
      .resolves.toBe('registered');
    await expect(controller.login({ email: 'a@example.com', password: 'secret' }))
      .resolves.toBe('logged-in');
    await expect(controller.refresh({ refreshToken: 'refresh' })).resolves.toBe('refreshed');
    await expect(controller.logout({ refreshToken: 'refresh' })).resolves.toEqual({ ok: true });
    const user: AuthUser = { id: 'user-1', email: 'a@example.com', role: 'user' };
    await expect(controller.me(user)).resolves.toBe('profile');

    expect(auth.register).toHaveBeenCalledWith('a@example.com', 'password', undefined);
    expect(auth.login).toHaveBeenCalledWith('a@example.com', 'secret');
    expect(auth.refresh).toHaveBeenCalledWith('refresh');
    expect(auth.logout).toHaveBeenCalledWith('refresh');
    expect(auth.me).toHaveBeenCalledWith('user-1');
  });

  it('SyncController scopes all operations to the authenticated user', async () => {
    const sync = {
      list: vi.fn().mockResolvedValue('list'), replace: vi.fn().mockResolvedValue('replace'),
      upsert: vi.fn().mockResolvedValue('upsert'), delete: vi.fn().mockResolvedValue('delete'),
      listProviders: vi.fn().mockResolvedValue('provider-list'),
      replaceProviders: vi.fn().mockResolvedValue('provider-replace'),
      upsertProvider: vi.fn().mockResolvedValue('provider-upsert'),
      deleteProvider: vi.fn().mockResolvedValue('provider-delete'),
    };
    const controller = new SyncController(sync as unknown as SyncService);
    const user: AuthUser = { id: 'owner-1', email: 'owner@example.com', role: 'user' };
    const account = makeAccount();
    const provider = makeProvider();

    await expect(controller.list(user)).resolves.toBe('list');
    await expect(controller.replace(user, { accounts: [account] })).resolves.toBe('replace');
    await expect(controller.upsert(user, account.id, account)).resolves.toBe('upsert');
    await expect(controller.delete(user, account.id)).resolves.toBe('delete');
    await expect(controller.listProviders(user)).resolves.toBe('provider-list');
    await expect(controller.replaceProviders(user, { providers: [provider] })).resolves.toBe('provider-replace');
    await expect(controller.upsertProvider(user, provider.id, provider)).resolves.toBe('provider-upsert');
    await expect(controller.deleteProvider(user, provider.id)).resolves.toBe('provider-delete');

    expect(sync.list).toHaveBeenCalledWith(user.id);
    expect(sync.replace).toHaveBeenCalledWith(user.id, { accounts: [account] });
    expect(sync.upsert).toHaveBeenCalledWith(user.id, account.id, account);
    expect(sync.delete).toHaveBeenCalledWith(user.id, account.id);
    expect(sync.listProviders).toHaveBeenCalledWith(user.id);
    expect(sync.replaceProviders).toHaveBeenCalledWith(user.id, { providers: [provider] });
    expect(sync.upsertProvider).toHaveBeenCalledWith(user.id, provider.id, provider);
    expect(sync.deleteProvider).toHaveBeenCalledWith(user.id, provider.id);
  });

  it('AdminController serves the page and delegates protected user management', async () => {
    const admin = {
      listUsers: vi.fn().mockResolvedValue('users'), createUser: vi.fn().mockResolvedValue('created'),
      updateUser: vi.fn().mockResolvedValue('updated'), deleteUser: vi.fn().mockResolvedValue('deleted'),
      changePassword: vi.fn().mockResolvedValue({ ok: true }),
      listUserAccounts: vi.fn().mockResolvedValue('accounts'),
      updateUserAccount: vi.fn().mockResolvedValue('account-updated'),
      deleteUserAccount: vi.fn().mockResolvedValue('account-deleted'),
      listAuditLogs: vi.fn().mockResolvedValue('logs'),
      listInvitations: vi.fn().mockResolvedValue('invitations'),
      createInvitation: vi.fn().mockResolvedValue('invitation'),
      revokeInvitation: vi.fn().mockResolvedValue('revoked'),
      listApprovalRequests: vi.fn().mockResolvedValue('approvals'),
      createApprovalRequest: vi.fn().mockResolvedValue('approval'),
      reviewApprovalRequest: vi.fn().mockResolvedValue('reviewed'),
    };
    const controller = new AdminController(admin as unknown as AdminService);
    const response = { sendFile: vi.fn().mockReturnValue('sent') };
    const actor: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

    expect(controller.page(response as unknown as Response)).toBe('sent');
    expect(response.sendFile).toHaveBeenCalledWith(expect.stringMatching(/[\\/]public[\\/]admin\.html$/));
    await expect(controller.listUsers({ page: 1 })).resolves.toBe('users');
    await expect(controller.createUser(actor, {
      email: 'new@example.com', password: 'password', role: 'admin', disabled: false,
    }))
      .resolves.toBe('created');
    await expect(controller.updateUser(actor, 'user-1', { disabled: true })).resolves.toBe('updated');
    await expect(controller.deleteUser(actor, 'user-1')).resolves.toBe('deleted');
    await expect(controller.changePassword(actor, {
      currentPassword: 'old-pass', newPassword: 'new-password',
    })).resolves.toEqual({ ok: true });
    await expect(controller.listUserAccounts('user-1')).resolves.toBe('accounts');
    await expect(controller.updateUserAccount(actor, 'user-1', 'account-1', { active: false }))
      .resolves.toBe('account-updated');
    await expect(controller.deleteUserAccount(actor, 'user-1', 'account-1'))
      .resolves.toBe('account-deleted');
    await expect(controller.listAuditLogs({ page: 1 })).resolves.toBe('logs');
    await expect(controller.listInvitations({ page: 1 })).resolves.toBe('invitations');
    await expect(controller.createInvitation(actor, { email: 'invite@example.com' }))
      .resolves.toBe('invitation');
    await expect(controller.revokeInvitation(actor, 'invitation-1')).resolves.toBe('revoked');
    await expect(controller.listApprovalRequests({ page: 1 })).resolves.toBe('approvals');
    await expect(controller.createApprovalRequest(actor, {
      type: 'promote_user_to_admin', targetUserId: 'user-1',
    })).resolves.toBe('approval');
    await expect(controller.reviewApprovalRequest(actor, 'approval-1', { decision: 'approved' }))
      .resolves.toBe('reviewed');

    expect(admin.createUser).toHaveBeenCalledWith(actor, {
      email: 'new@example.com', password: 'password', role: 'admin', disabled: false,
    });
    expect(admin.updateUser).toHaveBeenCalledWith(actor, 'user-1', { disabled: true });
  });
});
