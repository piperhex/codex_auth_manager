import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAdminUserDto, UpdateAdminUserDto } from '@/modules/admin/dto/admin-user.dto';
import {
  CreateApprovalRequestDto,
  CreateInvitationDto,
  ReviewApprovalRequestDto,
  UpdateAdminSyncedAccountDto,
} from '@/modules/admin/dto/admin-management.dto';
import { LoginDto } from '@/modules/auth/dto/login.dto';
import { RefreshDto } from '@/modules/auth/dto/refresh.dto';
import { RegisterDto } from '@/modules/auth/dto/register.dto';
import { PutSyncAccountsDto, SyncAccountDto } from '@/modules/sync/dto/sync-accounts.dto';
import { makeAccount } from './fixtures';

async function messages<T extends object>(type: new () => T, value: object) {
  const errors = await validate(plainToInstance(type, value));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('request DTO validation', () => {
  it('enforces authentication email, password and token contracts', async () => {
    await expect(messages(RegisterDto, { email: 'bad', password: 'short' }))
      .resolves.toEqual(expect.arrayContaining([
        'email must be an email', 'password must be longer than or equal to 8 characters',
      ]));
    await expect(messages(LoginDto, { email: 'valid@example.com', password: '12345' }))
      .resolves.toContain('password must be longer than or equal to 6 characters');
    await expect(messages(RefreshDto, { refreshToken: 123 })).resolves.toContain('refreshToken must be a string');
    await expect(messages(RegisterDto, { email: 'valid@example.com', password: '12345678' }))
      .resolves.toEqual([]);
  });

  it('restricts admin user roles, password length and patch types', async () => {
    await expect(messages(CreateAdminUserDto, {
      email: 'admin@example.com', password: '1234567', role: 'superuser',
    })).resolves.toEqual(expect.arrayContaining([
      'password must be longer than or equal to 8 characters',
      'role must be one of the following values: user, admin',
    ]));
    await expect(messages(UpdateAdminUserDto, { disabled: 'yes', role: 'owner' }))
      .resolves.toEqual(expect.arrayContaining([
        'disabled must be a boolean value',
        'role must be one of the following values: user, admin',
      ]));
    await expect(messages(UpdateAdminUserDto, { email: 'bad', password: 'short' }))
      .resolves.toEqual(expect.arrayContaining([
        'email must be an email',
        'password must be longer than or equal to 8 characters',
      ]));
    await expect(messages(UpdateAdminUserDto, {})).resolves.toEqual([]);
  });

  it('validates management invitations, approvals and admin account edits', async () => {
    await expect(messages(CreateInvitationDto, {
      email: 'bad', role: 'owner', expiresInHours: 0,
    })).resolves.toEqual(expect.arrayContaining([
      'email must be an email',
      'role must be one of the following values: user, admin',
      'expiresInHours must not be less than 1',
    ]));
    await expect(messages(CreateApprovalRequestDto, {
      type: 'delete_everything', targetUserId: 123,
    })).resolves.toEqual(expect.arrayContaining([
      'type must be one of the following values: promote_user_to_admin',
      'targetUserId must be a string',
    ]));
    await expect(messages(ReviewApprovalRequestDto, { decision: 'maybe' }))
      .resolves.toContain('decision must be one of the following values: approved, rejected');
    await expect(messages(UpdateAdminSyncedAccountDto, {
      email: 'x'.repeat(241), active: 'yes', usage: 'none',
    })).resolves.toEqual(expect.arrayContaining([
      'email must be shorter than or equal to 240 characters',
      'active must be a boolean value',
      'usage must be an object',
    ]));
  });

  it('validates nested sync accounts and accepts a complete valid payload', async () => {
    const valid = plainToInstance(PutSyncAccountsDto, { accounts: [makeAccount()] });
    expect(valid.accounts[0]).toBeInstanceOf(SyncAccountDto);
    await expect(validate(valid)).resolves.toEqual([]);

    const invalid = plainToInstance(PutSyncAccountsDto, {
      accounts: [{ ...makeAccount(), id: 'x'.repeat(65), active: 'yes', usage: 'none' }],
    });
    const errors = await validate(invalid);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('accounts');
    expect(errors[0].children?.[0].children?.map((error) => error.property))
      .toEqual(expect.arrayContaining(['id', 'active', 'usage']));
  });

  it('applies sync DTO defaults while allowing a nullable provider account id', async () => {
    const value = plainToInstance(SyncAccountDto, {
      id: 'account-1', email: 'a@example.com', plan: 'Plus', accountId: null,
      active: false, usage: {}, auth: {},
    });
    expect(value.note).toBe('');
    expect(value.expiresAt).toBe('');
    await expect(validate(value)).resolves.toEqual([]);
  });
});
