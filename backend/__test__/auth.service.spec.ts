import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { Repository } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '@/modules/auth/auth.service';
import type { AdminService } from '@/modules/admin/admin.service';
import type { RefreshTokenEntity } from '@/modules/auth/entities/refresh-token.entity';
import type { UserService } from '@/modules/user/user.service';
import { makeUser } from './fixtures';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('AuthService', () => {
  let users: {
    createUser: ReturnType<typeof vi.fn>;
    findByEmailWithPassword: ReturnType<typeof vi.fn>;
    validatePassword: ReturnType<typeof vi.fn>;
    markLogin: ReturnType<typeof vi.fn>;
    findActiveById: ReturnType<typeof vi.fn>;
  };
  let jwt: { signAsync: ReturnType<typeof vi.fn>; verifyAsync: ReturnType<typeof vi.fn> };
  let admin: {
    validateInvitation: ReturnType<typeof vi.fn>;
    acceptInvitation: ReturnType<typeof vi.fn>;
  };
  let tokens: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  let service: AuthService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T00:00:00.000Z'));
    users = {
      createUser: vi.fn(), findByEmailWithPassword: vi.fn(), validatePassword: vi.fn(),
      markLogin: vi.fn(), findActiveById: vi.fn(),
    };
    admin = {
      validateInvitation: vi.fn(),
      acceptInvitation: vi.fn(),
    };
    jwt = { signAsync: vi.fn(), verifyAsync: vi.fn() };
    tokens = {
      create: vi.fn((value) => ({ id: 'refresh-id', ...value })),
      save: vi.fn(async (value) => value), findOne: vi.fn(), update: vi.fn(),
    };
    service = new AuthService(
      users as unknown as UserService,
      admin as unknown as AdminService,
      jwt as unknown as JwtService,
      tokens as unknown as Repository<RefreshTokenEntity>,
      {
        KONG_JWT_KEY: 'kong-key',
        KONG_JWT_SECRET: 'kong-secret',
        JWT_ACCESS_EXPIRES: '5m',
        JWT_REFRESH_SECRET: 'refresh-secret',
        REFRESH_TOKEN_TTL_SECONDS: '120',
      },
    );
  });

  afterEach(() => vi.useRealTimers());

  function prepareIssuance() {
    jwt.signAsync.mockResolvedValueOnce('access-token').mockResolvedValueOnce('refresh-token');
  }

  it('registers a user and issues persistently hashed access/refresh tokens', async () => {
    const user = makeUser();
    users.createUser.mockResolvedValue(user);
    prepareIssuance();

    await expect(service.register('USER@example.com', 'password'))
      .resolves.toEqual({
        accessToken: 'access-token', refreshToken: 'refresh-token',
        user: { id: user.id, email: user.email, role: user.role },
      });

    expect(users.createUser).toHaveBeenCalledWith({ email: 'USER@example.com', password: 'password' });
    expect(jwt.signAsync).toHaveBeenNthCalledWith(1, {
      sub: user.id, email: user.email, role: user.role, iss: 'kong-key',
    }, { secret: 'kong-secret', expiresIn: '5m' });
    expect(tokens.create).toHaveBeenCalledWith({
      userId: user.id, expiresAt: new Date('2026-07-04T00:02:00.000Z'),
    });
    expect(jwt.signAsync).toHaveBeenNthCalledWith(2, {
      sub: user.id, tokenId: 'refresh-id', typ: 'refresh',
    }, { secret: 'refresh-secret', expiresIn: 120 });
    expect(tokens.save).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: hash('refresh-token') }));
    expect(tokens.save.mock.calls[0][0].tokenHash).not.toBe('refresh-token');
  });

  it('registers with an invitation role and marks the invitation accepted', async () => {
    const user = makeUser({ role: 'admin' });
    admin.validateInvitation.mockResolvedValue({
      id: 'invitation-1', email: user.email, role: 'admin',
    });
    users.createUser.mockResolvedValue(user);
    prepareIssuance();

    await service.register(user.email, 'password', 'invite-token');

    expect(admin.validateInvitation).toHaveBeenCalledWith('invite-token', user.email);
    expect(users.createUser).toHaveBeenCalledWith({
      email: user.email, password: 'password', role: 'admin',
    });
    expect(admin.acceptInvitation).toHaveBeenCalledWith('invitation-1', user);
  });

  it.each([
    ['unknown user', null, false],
    ['disabled user', makeUser({ disabled: true }), false],
    ['wrong password', makeUser(), false],
  ])('rejects login for %s', async (_, user, validPassword) => {
    users.findByEmailWithPassword.mockResolvedValue(user);
    users.validatePassword.mockResolvedValue(validPassword);
    await expect(service.login('user@example.com', 'wrong'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.markLogin).not.toHaveBeenCalled();
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('marks a successful login before issuing tokens', async () => {
    const user = makeUser();
    users.findByEmailWithPassword.mockResolvedValue(user);
    users.validatePassword.mockResolvedValue(true);
    prepareIssuance();
    await service.login(user.email, 'correct-password');
    expect(users.validatePassword).toHaveBeenCalledWith(user, 'correct-password');
    expect(users.markLogin).toHaveBeenCalledWith(user.id);
    expect(users.markLogin.mock.invocationCallOrder[0]).toBeLessThan(jwt.signAsync.mock.invocationCallOrder[0]);
  });

  it('maps verification failures and wrong token types to unauthorized', async () => {
    jwt.verifyAsync.mockRejectedValueOnce(new Error('bad signature'));
    await expect(service.refresh('bad-token')).rejects.toThrow('Refresh token is invalid');

    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'user-1', tokenId: 'token-1', typ: 'access' });
    await expect(service.refresh('access-token')).rejects.toThrow('Refresh token is invalid');
    expect(tokens.findOne).not.toHaveBeenCalled();
  });

  it('rotates a valid refresh token and revokes the old record', async () => {
    const user = makeUser();
    const oldToken = {
      id: 'old-token-id', userId: user.id, user, tokenHash: hash('old-refresh'),
      expiresAt: new Date('2026-07-04T00:01:00.000Z'), revokedAt: null,
    };
    jwt.verifyAsync.mockResolvedValue({ sub: user.id, tokenId: oldToken.id, typ: 'refresh' });
    tokens.findOne.mockResolvedValue(oldToken);
    prepareIssuance();

    await expect(service.refresh('old-refresh')).resolves.toMatchObject({ accessToken: 'access-token' });

    expect(jwt.verifyAsync).toHaveBeenCalledWith('old-refresh', { secret: 'refresh-secret' });
    expect(tokens.findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: oldToken.id, userId: user.id, tokenHash: hash('old-refresh'), revokedAt: expect.anything(),
      }),
      relations: { user: true },
    });
    expect(oldToken.revokedAt).toEqual(new Date('2026-07-04T00:00:00.000Z'));
    expect(tokens.save).toHaveBeenNthCalledWith(1, oldToken);
  });

  it.each([
    ['missing record', null],
    ['expired record', { expiresAt: new Date('2026-07-04T00:00:00.000Z'), user: makeUser() }],
    ['disabled owner', { expiresAt: new Date('2026-07-04T00:01:00.000Z'), user: makeUser({ disabled: true }) }],
  ])('rejects refresh for %s', async (_, token) => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', tokenId: 'token-1', typ: 'refresh' });
    tokens.findOne.mockResolvedValue(token);
    await expect(service.refresh('refresh')).rejects.toThrow('Refresh token expired');
    expect(tokens.save).not.toHaveBeenCalled();
  });

  it('revokes matching live tokens on logout without exposing storage details', async () => {
    await expect(service.logout('logout-token')).resolves.toEqual({ ok: true });
    expect(tokens.update).toHaveBeenCalledWith(
      { tokenHash: hash('logout-token'), revokedAt: expect.anything() },
      { revokedAt: new Date('2026-07-04T00:00:00.000Z') },
    );
  });

  it('returns only the public profile for an active user', async () => {
    const user = makeUser({ role: 'admin' });
    users.findActiveById.mockResolvedValue(user);
    await expect(service.me(user.id)).resolves.toEqual({ id: user.id, email: user.email, role: 'admin' });
  });

  it('rejects profile lookup when the user is unavailable', async () => {
    users.findActiveById.mockResolvedValue(null);
    await expect(service.me('missing')).rejects.toThrow('User not found');
  });

  it('uses documented token defaults when optional settings are absent', async () => {
    const user = makeUser();
    service = new AuthService(
      users as unknown as UserService,
      admin as unknown as AdminService,
      jwt as unknown as JwtService,
      tokens as unknown as Repository<RefreshTokenEntity>,
      {},
    );
    users.createUser.mockResolvedValue(user);
    prepareIssuance();
    await service.register(user.email, 'password');
    expect(jwt.signAsync).toHaveBeenNthCalledWith(1, expect.objectContaining({ iss: 'codex-switch' }), {
      secret: 'change-me-kong-jwt-secret', expiresIn: '15m',
    });
    expect(jwt.signAsync).toHaveBeenNthCalledWith(2, expect.any(Object), {
      secret: 'replace-with-refresh-secret', expiresIn: 2_592_000,
    });
  });
});
