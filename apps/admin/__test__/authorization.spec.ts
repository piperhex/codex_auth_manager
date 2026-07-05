import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AdminGuard } from '@/common/guards/admin.guard';
import { JwtStrategy } from '@/modules/jwt/jwt.strategy';
import type { UserService } from '@/modules/user/user.service';
import type { AuthUser } from '@/common/decorators/user.decorator';
import { makeUser } from './fixtures';

function contextWithUser(user?: AuthUser): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('authorization boundaries', () => {
  it('AdminGuard permits admins only', () => {
    const guard = new AdminGuard();
    expect(guard.canActivate(contextWithUser({
      id: 'admin-1', email: 'admin@example.com', role: 'admin',
    }))).toBe(true);
    expect(() => guard.canActivate(contextWithUser({
      id: 'user-1', email: 'user@example.com', role: 'user',
    }))).toThrow(ForbiddenException);
    expect(() => guard.canActivate(contextWithUser())).toThrow('Admin permission required');
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
