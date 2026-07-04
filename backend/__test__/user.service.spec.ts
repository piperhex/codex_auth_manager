import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserService } from '@/modules/user/user.service';
import type { UserEntity } from '@/modules/user/entities/user.entity';
import { makeUser } from './fixtures';

describe('UserService', () => {
  let repository: {
    exists: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findOne: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let service: UserService;

  beforeEach(() => {
    repository = {
      exists: vi.fn(), count: vi.fn(), create: vi.fn((value) => value),
      save: vi.fn(async (value) => value), findOne: vi.fn(), update: vi.fn(), find: vi.fn(),
      findAndCount: vi.fn(), delete: vi.fn(),
    };
    service = new UserService(repository as unknown as Repository<UserEntity>);
  });

  it('normalizes email, hashes password and makes the first user an admin', async () => {
    repository.exists.mockResolvedValue(false);
    repository.count.mockResolvedValue(0);

    const user = await service.createUser({ email: '  First@Example.COM ', password: 'strong-pass' });

    expect(repository.exists).toHaveBeenCalledWith({ where: { email: 'first@example.com' } });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      email: 'first@example.com', role: 'admin', passwordHash: expect.any(String),
    }));
    expect(user.passwordHash).not.toBe('strong-pass');
    await expect(service.validatePassword(user, 'strong-pass')).resolves.toBe(true);
  });

  it('honors an explicit role for subsequent users', async () => {
    repository.exists.mockResolvedValue(false);
    repository.count.mockResolvedValue(9);
    await service.createUser({ email: 'u@example.com', password: 'password', role: 'admin' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
  });

  it('defaults subsequent users to user role', async () => {
    repository.exists.mockResolvedValue(false);
    repository.count.mockResolvedValue(1);
    await service.createUser({ email: 'u@example.com', password: 'password' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));
  });

  it('rejects duplicate normalized email before hashing or saving', async () => {
    repository.exists.mockResolvedValue(true);
    await expect(service.createUser({ email: ' DUP@example.com ', password: 'password' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(repository.count).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('queries credentials and active users with restrictive filters', async () => {
    await service.findByEmailWithPassword(' User@Example.COM ');
    expect(repository.findOne).toHaveBeenNthCalledWith(1, {
      where: { email: 'user@example.com' },
      select: ['id', 'email', 'passwordHash', 'role', 'disabled'],
    });
    await service.findActiveById('user-2');
    expect(repository.findOne).toHaveBeenNthCalledWith(2, { where: { id: 'user-2', disabled: false } });
  });

  it('marks login and lists newest users first', async () => {
    await service.markLogin('user-1');
    expect(repository.update).toHaveBeenCalledWith(
      { id: 'user-1' }, { lastLoginAt: expect.any(Date) },
    );
    await service.listUsers();
    expect(repository.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
  });

  it('lists users with pagination, search and filters', async () => {
    repository.findAndCount.mockResolvedValue([[makeUser()], 1]);
    await expect(service.listUsers({
      search: 'EXAMPLE', role: 'admin', status: 'active', page: 2, pageSize: 10,
    })).resolves.toMatchObject({ total: 1, page: 2, pageSize: 10 });
    expect(repository.findAndCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        role: 'admin',
        disabled: false,
        email: expect.any(Object),
      }),
      skip: 10,
      take: 10,
      order: { createdAt: 'DESC' },
    }));
  });

  it('updates only supplied mutable fields', async () => {
    const user = makeUser();
    repository.findOne.mockResolvedValue(user);
    repository.exists.mockResolvedValue(false);
    await expect(service.updateUser(user.id, {
      disabled: true, role: 'admin', email: ' Changed@Example.COM ', password: 'new-password',
    })).resolves.toMatchObject({ disabled: true, role: 'admin', email: 'changed@example.com' });
    expect(repository.save).toHaveBeenCalledWith(user);
    await expect(service.validatePassword(user, 'new-password')).resolves.toBe(true);

    const unchanged = makeUser({ id: 'user-2' });
    repository.findOne.mockResolvedValue(unchanged);
    await service.updateUser(unchanged.id, {});
    expect(unchanged).toMatchObject({ disabled: false, role: 'user' });
  });

  it('throws when updating an unknown user', async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.updateUser('missing', { disabled: true }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects duplicate emails when updating a user', async () => {
    repository.findOne.mockResolvedValue(makeUser());
    repository.exists.mockResolvedValue(true);
    await expect(service.updateUser('user-1', { email: 'taken@example.com' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('changes a password only when the current password is valid', async () => {
    const user = makeUser({ passwordHash: await import('bcryptjs').then((bcrypt) => bcrypt.hash('old-pass', 12)) });
    repository.findOne.mockResolvedValue(user);
    await expect(service.changePassword(user.id, 'old-pass', 'new-password')).resolves.toEqual({ ok: true });
    await expect(service.validatePassword(user, 'new-password')).resolves.toBe(true);

    repository.findOne.mockResolvedValue(user);
    await expect(service.changePassword(user.id, 'wrong-pass', 'newer-password'))
      .rejects.toThrow('Current password is invalid');
  });

  it('deletes users but preserves the last active administrator', async () => {
    repository.findOne.mockResolvedValue(makeUser({ id: 'admin-1', role: 'admin' }));
    repository.count.mockResolvedValue(1);
    await expect(service.deleteUser('admin-1')).rejects.toThrow('At least one active admin must remain');

    repository.findOne.mockResolvedValue(makeUser({ id: 'user-1', email: 'u@example.com' }));
    await expect(service.deleteUser('user-1')).resolves.toEqual({ id: 'user-1', email: 'u@example.com' });
    expect(repository.delete).toHaveBeenCalledWith({ id: 'user-1' });
  });
});
