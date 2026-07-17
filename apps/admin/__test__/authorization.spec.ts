import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { Permission, permissionsForRole } from '@/common/rbac/permissions';
import { JwtStrategy } from '@/modules/jwt/jwt.strategy';
import type { UserService } from '@/modules/user/user.service';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { makeUser } from './fixtures';

function contextWithUser(user?: AuthUser): ExecutionContext {
  return {
    getHandler: () => contextWithUser,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('authorization boundaries', () => {
  it('PermissionsGuard allows role grants and rejects missing admin grants', () => {
    const reflector = {
      getAllAndOverride: vi.fn().mockReturnValue([Permission.SelfAccountsRead]),
    };
    const guard = new PermissionsGuard(reflector as unknown as Reflector);
    const user: AuthUser = { id: 'user-1', email: 'user@example.com', role: 'user' };
    const admin: AuthUser = { id: 'admin-1', email: 'admin@example.com', role: 'admin' };

    expect(guard.canActivate(contextWithUser(user))).toBe(true);
    expect(guard.canActivate(contextWithUser(admin))).toBe(true);

    reflector.getAllAndOverride.mockReturnValue([Permission.UsersManage]);
    expect(() => guard.canActivate(contextWithUser(user))).toThrow(ForbiddenException);
    expect(guard.canActivate(contextWithUser(admin))).toBe(true);
    expect(() => guard.canActivate(contextWithUser())).toThrow('Insufficient permission');

    reflector.getAllAndOverride.mockReturnValue([]);
    expect(() => guard.canActivate(contextWithUser(admin)))
      .toThrow('Route permission is not configured');
  });

  it('maps ordinary users to self-service permissions only', () => {
    expect(permissionsForRole('user')).toEqual([
      Permission.SelfAccountsRead,
      Permission.SelfAccountsWrite,
      Permission.SelfProvidersRead,
      Permission.SelfProvidersWrite,
      Permission.SelfPasswordUpdate,
    ]);
    expect(permissionsForRole('user')).not.toContain(Permission.UsersRead);
    expect(permissionsForRole('user')).not.toContain(Permission.TelemetryRead);
    expect(permissionsForRole('admin')).toEqual(expect.arrayContaining(Object.values(Permission)));
  });

  it('JwtStrategy rehydrates identity from current database state', async () => {
    const user = makeUser({ email: 'current@example.com', role: 'admin' });
    const users = { findActiveById: vi.fn().mockResolvedValue(user) };
    const strategy = new JwtStrategy(
      { KONG_JWT_SECRET: 'configured-secret' }, users as unknown as UserService,
    );

    await expect(strategy.validate({
      sub: user.id, email: 'stale@example.com', role: 'user', iss: 'issuer',
    })).resolves.toEqual({ id: user.id, email: user.email, role: user.role });
    expect(users.findActiveById).toHaveBeenCalledWith(user.id);
  });

  it('JwtStrategy rejects deleted or disabled users', async () => {
    const users = { findActiveById: vi.fn().mockResolvedValue(null) };
    const strategy = new JwtStrategy({}, users as unknown as UserService);
    await expect(strategy.validate({
      sub: 'missing', email: 'old@example.com', role: 'user', iss: 'issuer',
    })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
