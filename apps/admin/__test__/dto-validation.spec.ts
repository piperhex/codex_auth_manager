import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { CreateAdminUserDto, UpdateAdminUserDto } from '@/modules/admin/dto/admin-user.dto';
import {
  CreateApprovalRequestDto,
  ChangeSystemAccountBindingsDto,
  CreateSystemAccountDto,
  ImportSystemAccountsDto,
  CreateInvitationDto,
  ReviewApprovalRequestDto,
  UpdateAdminSyncedAccountDto,
  UpdateOwnSyncedAccountDto,
} from '@/modules/admin/dto/admin-management.dto';
import { LoginDto } from '@/modules/auth/dto/login.dto';
import { UpdateAnnouncementDto } from '@/modules/announcement/dto/update-announcement.dto';
import { RefreshDto } from '@/modules/auth/dto/refresh.dto';
import { RegisterDto } from '@/modules/auth/dto/register.dto';
import { RequestPasswordResetCodeDto } from '@/modules/auth/dto/request-password-reset-code.dto';
import { ResetPasswordDto } from '@/modules/auth/dto/reset-password.dto';
import { PutSyncAccountsDto, SyncAccountDto } from '@/modules/sync/dto/sync-accounts.dto';
import { PutSyncProvidersDto, SyncProviderDto } from '@/modules/sync/dto/sync-providers.dto';
import {
  ListDeviceInstallationsQueryDto,
  ListTelemetryEventsQueryDto,
} from '@/modules/telemetry/dto/list-telemetry.dto';
import { makeAccount, makeProvider } from './fixtures';

async function messages<T extends object>(type: new () => T, value: object) {
  const errors = await validate(plainToInstance(type, value));
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('request DTO validation', () => {
  it('enforces authentication email, password and token contracts', async () => {
    await expect(messages(RegisterDto, { email: 'bad', password: 'short', verificationCode: '12ab' }))
      .resolves.toEqual(expect.arrayContaining([
        'email must be an email', 'password must be longer than or equal to 8 characters',
        'verificationCode must be a 6-digit number',
      ]));
    await expect(messages(LoginDto, { email: 'valid@example.com', password: '12345' }))
      .resolves.toContain('password must be longer than or equal to 6 characters');
    await expect(messages(RefreshDto, { refreshToken: 123 })).resolves.toContain('refreshToken must be a string');
    await expect(messages(RegisterDto, {
      email: 'valid@example.com', password: '12345678', verificationCode: '123456',
    }))
      .resolves.toEqual([]);
    await expect(messages(RequestPasswordResetCodeDto, { email: 'bad' }))
      .resolves.toContain('email must be an email');
    await expect(messages(ResetPasswordDto, {
      email: 'valid@example.com', verificationCode: '12ab', newPassword: 'short',
    })).resolves.toEqual(expect.arrayContaining([
      'verificationCode must be a 6-digit number',
      'newPassword must be longer than or equal to 8 characters',
    ]));
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
    await expect(messages(CreateAdminUserDto, {
      email: 'admin@example.com', password: 'password', role: 'user', disabled: false,
    })).resolves.toEqual([]);
    await expect(messages(UpdateAdminUserDto, {})).resolves.toEqual([]);
  });

  it('validates management invitations, approvals and admin account edits', async () => {
    await expect(messages(CreateInvitationDto, {
      email: 'bad', role: 'owner', expiresInHours: 0, maxUses: 0, neverExpires: 'yes',
    })).resolves.toEqual(expect.arrayContaining([
      'email must be an email',
      'role must be one of the following values: user, admin',
      'expiresInHours must not be less than 1',
      'maxUses must not be less than 1',
      'neverExpires must be a boolean value',
    ]));
    await expect(messages(CreateInvitationDto, {
      role: 'user', maxUses: 5, neverExpires: true,
    })).resolves.toEqual([]);
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
    await expect(messages(UpdateOwnSyncedAccountDto, {
      note: 'x'.repeat(1001), expiresAt: 'x'.repeat(41),
    })).resolves.toEqual(expect.arrayContaining([
      'note must be shorter than or equal to 1000 characters',
      'expiresAt must be shorter than or equal to 40 characters',
    ]));
  });

  it('restricts announcement scroll duration to whole seconds from 5 through 120', async () => {
    const validAnnouncement = {
      content: 'Scheduled maintenance',
      enabled: true,
      textColor: '#FFFFFF',
      backgroundColor: '#000000',
      scrollDurationSeconds: 22,
    };
    await expect(messages(UpdateAnnouncementDto, validAnnouncement)).resolves.toEqual([]);
    await expect(messages(UpdateAnnouncementDto, {
      ...validAnnouncement,
      scrollDurationSeconds: 4,
    })).resolves.toContain('scrollDurationSeconds must not be less than 5');
    await expect(messages(UpdateAnnouncementDto, {
      ...validAnnouncement,
      scrollDurationSeconds: 120.5,
    })).resolves.toContain('scrollDurationSeconds must be an integer number');
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

  it('validates official account credentials and bulk binding identifiers', async () => {
    await expect(messages(CreateSystemAccountDto, {
      auth: 'not-an-object',
      note: 'x'.repeat(1001),
    })).resolves.toEqual(expect.arrayContaining([
      'auth must be an object',
      'note must be shorter than or equal to 1000 characters',
    ]));
    await expect(messages(ChangeSystemAccountBindingsDto, {
      systemAccountIds: [],
      userIds: ['not-a-uuid'],
    })).resolves.toEqual(expect.arrayContaining([
      'systemAccountIds should not be empty',
      'each value in userIds must be a UUID',
    ]));
    await expect(messages(ChangeSystemAccountBindingsDto, {
      systemAccountIds: ['10000000-0000-4000-8000-000000000001'],
      userIds: ['20000000-0000-4000-8000-000000000001'],
    })).resolves.toEqual([]);
  });

  it('validates telemetry paging and supported filters', async () => {
    await expect(messages(ListDeviceInstallationsQueryDto, {
      page: 0,
      pageSize: 101,
      platform: 'android',
      search: 'x'.repeat(37),
    })).resolves.toEqual(expect.arrayContaining([
      'page must not be less than 1',
      'pageSize must not be greater than 100',
      'platform must be one of the following values: windows, macos, linux',
      'search must be shorter than or equal to 36 characters',
    ]));
    await expect(messages(ListTelemetryEventsQueryDto, {
      page: '2',
      pageSize: '50',
      platform: 'linux',
      eventType: 'base_url_changed',
    })).resolves.toEqual([]);
    await expect(messages(ImportSystemAccountsDto, {
      content: '',
      note: 'x'.repeat(1001),
    })).resolves.toEqual(expect.arrayContaining([
      'content should not be empty',
      'note must be shorter than or equal to 1000 characters',
    ]));
    await expect(messages(ImportSystemAccountsDto, {
      content: '{"tokens":{"access_token":"token"}}',
      expiresAt: '2026-07-18T12:00:00.000Z',
    })).resolves.toEqual([]);
  });

  it('validates nested sync providers and accepts complete provider payloads', async () => {
    const valid = plainToInstance(PutSyncProvidersDto, { providers: [makeProvider()] });
    expect(valid.providers[0]).toBeInstanceOf(SyncProviderDto);
    await expect(validate(valid)).resolves.toEqual([]);

    const invalid = plainToInstance(PutSyncProvidersDto, {
      providers: [{
        ...makeProvider(),
        apiFormat: 'unsupported',
        models: ['ok', 123],
        modelSelectionControlledByCodex: 'yes',
      }],
    });
    const errors = await validate(invalid);
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('providers');
    expect(errors[0].children?.[0].children?.map((error) => error.property))
      .toEqual(expect.arrayContaining(['models', 'modelSelectionControlledByCodex', 'apiFormat']));
  });

  it('applies provider DTO defaults', async () => {
    const value = plainToInstance(SyncProviderDto, {
      id: 'provider-1',
      name: 'Gateway',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'sk-secret',
      model: 'gpt-4.1',
      apiFormat: 'openaiResponses',
    });
    expect(value.models).toEqual([]);
    expect(value.modelSelectionControlledByCodex).toBe(false);
    await expect(validate(value)).resolves.toEqual([]);
  });
});
