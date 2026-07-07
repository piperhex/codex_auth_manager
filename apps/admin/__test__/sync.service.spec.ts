import { BadRequestException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { DataSource, Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncService } from '@/modules/sync/sync.service';
import type { SyncedAccountEntity } from '@/modules/sync/entities/synced-account.entity';
import type { SyncedProviderEntity } from '@/modules/sync/entities/synced-provider.entity';
import { makeAccount, makeProvider } from './fixtures';

describe('SyncService', () => {
  let accounts: {
    find: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>;
  };
  let providers: {
    find: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>;
  };
  let transactionRepository: {
    delete: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn>;
  };
  let dataSource: { transaction: ReturnType<typeof vi.fn> };
  let redis: { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };
  let service: SyncService;

  beforeEach(() => {
    accounts = {
      find: vi.fn(), findOne: vi.fn(), update: vi.fn(),
      save: vi.fn(async (value) => value), delete: vi.fn(),
    };
    providers = {
      find: vi.fn(), findOne: vi.fn(),
      save: vi.fn(async (value) => value), delete: vi.fn(),
    };
    transactionRepository = {
      delete: vi.fn(), save: vi.fn(), create: vi.fn((value) => value),
      update: vi.fn(), findOne: vi.fn(),
    };
    dataSource = {
      transaction: vi.fn(async (work) => work({
        getRepository: vi.fn(() => transactionRepository),
      })),
    };
    redis = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
    service = new SyncService(
      accounts as unknown as Repository<SyncedAccountEntity>,
      providers as unknown as Repository<SyncedProviderEntity>,
      dataSource as unknown as DataSource,
      redis as unknown as Redis,
    );
  });

  it('returns a cache hit without querying PostgreSQL', async () => {
    const cached = { accounts: [makeAccount()] };
    redis.get.mockResolvedValue(JSON.stringify(cached));
    await expect(service.list('owner-1')).resolves.toEqual(cached);
    expect(redis.get).toHaveBeenCalledWith('sync:accounts:owner-1');
    expect(accounts.find).not.toHaveBeenCalled();
  });

  it('loads, maps, sorts and caches a cache miss', async () => {
    redis.get.mockResolvedValue(null);
    accounts.find.mockResolvedValue([{
      ownerId: 'owner-1', accountId: 'account-1', email: 'a@example.com', note: '',
      expiresAt: '', plan: 'Plus', codexAccountId: null, active: false,
      usage: { used: 2 }, lastModifiedAt: new Date('2026-07-05T00:00:00.000Z'),
      auth: { token: 'x' },
    }]);
    const expected = { accounts: [makeAccount({
      email: 'a@example.com', note: '', expiresAt: '', accountId: null,
      active: false, usage: { used: 2 }, auth: { token: 'x' },
    })] };
    await expect(service.list('owner-1')).resolves.toEqual(expected);
    expect(accounts.find).toHaveBeenCalledWith({ where: { ownerId: 'owner-1' }, order: { email: 'ASC' } });
    expect(redis.set).toHaveBeenCalledWith(
      'sync:accounts:owner-1', JSON.stringify(expected), 'EX', 60,
    );
  });

  it('surfaces corrupted cache data instead of silently using stale storage', async () => {
    redis.get.mockResolvedValue('{not-json');
    await expect(service.list('owner-1')).rejects.toBeInstanceOf(SyntaxError);
    expect(accounts.find).not.toHaveBeenCalled();
  });

  it('atomically upserts all provided accounts and applies optional defaults', async () => {
    const first = makeAccount({ note: undefined as unknown as string, expiresAt: undefined as unknown as string,
      accountId: undefined, usage: undefined as unknown as Record<string, unknown> });
    const second = makeAccount({ id: 'account-2', active: false });
    transactionRepository.findOne
      .mockResolvedValueOnce({ id: 'database-id-1' })
      .mockResolvedValueOnce(null);
    await expect(service.replace('owner-1', { accounts: [first, second] })).resolves.toEqual({ count: 2 });
    expect(transactionRepository.delete).not.toHaveBeenCalled();
    expect(transactionRepository.update).toHaveBeenCalledWith({ ownerId: 'owner-1' }, { active: false });
    expect(transactionRepository.save).toHaveBeenNthCalledWith(1,
      expect.objectContaining({
        id: 'database-id-1', ownerId: 'owner-1', accountId: first.id, note: '', expiresAt: '',
        codexAccountId: null, usage: {}, lastModifiedAt: new Date(first.lastModifiedAt!),
      }),
    );
    expect(transactionRepository.save).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ id: undefined, accountId: 'account-2' }),
    );
    expect(redis.del).toHaveBeenCalledWith('sync:accounts:owner-1');
  });

  it('keeps existing rows and skips save for an empty replacement', async () => {
    await expect(service.replace('owner-1', { accounts: [] })).resolves.toEqual({ count: 0 });
    expect(transactionRepository.delete).not.toHaveBeenCalled();
    expect(transactionRepository.update).not.toHaveBeenCalled();
    expect(transactionRepository.save).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalled();
  });

  it('rejects an upsert when route and body ids differ before opening a transaction', async () => {
    await expect(service.upsert('owner-1', 'route-id', makeAccount({ id: 'body-id' })))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('upserts an active account, deactivating siblings and preserving the database id', async () => {
    const account = makeAccount();
    transactionRepository.findOne.mockResolvedValue({ id: 'database-id' });
    await expect(service.upsert('owner-1', account.id, account)).resolves.toEqual({ id: account.id });
    expect(transactionRepository.update).toHaveBeenCalledWith({ ownerId: 'owner-1' }, { active: false });
    expect(transactionRepository.findOne).toHaveBeenCalledWith({
      where: { ownerId: 'owner-1', accountId: account.id },
    });
    expect(transactionRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'database-id', ownerId: 'owner-1', accountId: account.id,
      lastModifiedAt: new Date(account.lastModifiedAt!),
    }));
    expect(transactionRepository.save).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('sync:accounts:owner-1');
  });

  it('keeps the existing remote account when an incoming upsert is older', async () => {
    const account = makeAccount({ lastModifiedAt: '2026-07-05T00:00:00.000Z' });
    transactionRepository.findOne.mockResolvedValue({
      id: 'database-id',
      lastModifiedAt: new Date('2026-07-05T00:00:01.000Z'),
    });

    await expect(service.upsert('owner-1', account.id, account)).resolves.toEqual({ id: account.id });

    expect(transactionRepository.update).not.toHaveBeenCalled();
    expect(transactionRepository.save).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('sync:accounts:owner-1');
  });

  it('upserts a new inactive account without deactivating siblings', async () => {
    const account = makeAccount({ active: false, note: undefined as unknown as string,
      expiresAt: undefined as unknown as string, accountId: undefined,
      usage: undefined as unknown as Record<string, unknown> });
    transactionRepository.findOne.mockResolvedValue(null);
    await service.upsert('owner-1', account.id, account);
    expect(transactionRepository.update).not.toHaveBeenCalled();
    expect(transactionRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      id: undefined, note: '', expiresAt: '', codexAccountId: null, usage: {}, active: false,
      lastModifiedAt: new Date(account.lastModifiedAt!),
    }));
  });

  it('deletes only the owner-scoped account and invalidates that owner cache', async () => {
    await expect(service.delete('owner-1', 'account-1')).resolves.toEqual({ id: 'account-1' });
    expect(accounts.delete).toHaveBeenCalledWith({ ownerId: 'owner-1', accountId: 'account-1' });
    expect(redis.del).toHaveBeenCalledWith('sync:accounts:owner-1');
  });

  it('loads and caches synced providers without exposing other owners', async () => {
    redis.get.mockResolvedValue(null);
    providers.find.mockResolvedValue([{
      ownerId: 'owner-1',
      providerId: 'provider-1',
      name: 'Gateway',
      baseUrl: 'https://gateway.example.com/v1',
      apiKey: 'sk-secret',
      model: 'gpt-4.1',
      models: ['gpt-4.1'],
      modelSelectionControlledByCodex: false,
      apiFormat: 'openaiResponses',
      lastModifiedAt: new Date('2026-07-05T00:00:00.000Z'),
    }]);
    const expected = { providers: [makeProvider({ apiKey: 'sk-secret' })] };

    await expect(service.listProviders('owner-1')).resolves.toEqual(expected);

    expect(providers.find).toHaveBeenCalledWith({ where: { ownerId: 'owner-1' }, order: { name: 'ASC' } });
    expect(redis.set).toHaveBeenCalledWith(
      'sync:providers:owner-1', JSON.stringify(expected), 'EX', 60,
    );
  });

  it('upserts a provider when the incoming profile is newer', async () => {
    const provider = makeProvider();
    transactionRepository.findOne.mockResolvedValue({
      id: 'database-id',
      lastModifiedAt: new Date('2026-07-04T00:00:00.000Z'),
    });

    await expect(service.upsertProvider('owner-1', provider.id, provider))
      .resolves.toEqual({ id: provider.id });

    expect(transactionRepository.findOne).toHaveBeenCalledWith({
      where: { ownerId: 'owner-1', providerId: provider.id },
    });
    expect(transactionRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      id: 'database-id',
      ownerId: 'owner-1',
      providerId: provider.id,
      apiKey: provider.apiKey,
      models: provider.models,
      lastModifiedAt: new Date(provider.lastModifiedAt!),
    }));
    expect(transactionRepository.save).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('sync:providers:owner-1');
  });

  it('keeps an existing provider when an incoming profile is older', async () => {
    const provider = makeProvider({ lastModifiedAt: '2026-07-05T00:00:00.000Z' });
    transactionRepository.findOne.mockResolvedValue({
      id: 'database-id',
      lastModifiedAt: new Date('2026-07-05T00:00:01.000Z'),
    });

    await expect(service.upsertProvider('owner-1', provider.id, provider))
      .resolves.toEqual({ id: provider.id });

    expect(transactionRepository.save).not.toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('sync:providers:owner-1');
  });

  it('rejects a provider upsert when route and body ids differ', async () => {
    await expect(service.upsertProvider('owner-1', 'route-id', makeProvider({ id: 'body-id' })))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('deletes only the owner-scoped provider and invalidates that owner cache', async () => {
    await expect(service.deleteProvider('owner-1', 'provider-1')).resolves.toEqual({ id: 'provider-1' });
    expect(providers.delete).toHaveBeenCalledWith({ ownerId: 'owner-1', providerId: 'provider-1' });
    expect(redis.del).toHaveBeenCalledWith('sync:providers:owner-1');
  });

  it('updates owner-scoped accounts for admin management and deactivates siblings when needed', async () => {
    accounts.findOne.mockResolvedValue({
      ownerId: 'owner-1',
      accountId: 'account-1',
      email: 'old@example.com',
      note: '',
      expiresAt: '',
      plan: 'Plus',
      codexAccountId: null,
      active: false,
      usage: {},
      lastModifiedAt: new Date('2026-07-04T00:00:00.000Z'),
      auth: { token: 'old' },
    });

    await expect(service.updateForAdmin('owner-1', 'account-1', {
      email: 'new@example.com',
      active: true,
      note: 'updated',
    })).resolves.toMatchObject({
      id: 'account-1',
      email: 'new@example.com',
      active: true,
      note: 'updated',
      lastModifiedAt: expect.any(String),
    });

    expect(accounts.findOne).toHaveBeenCalledWith({ where: { ownerId: 'owner-1', accountId: 'account-1' } });
    expect(accounts.update).toHaveBeenCalledWith({ ownerId: 'owner-1' }, { active: false });
    expect(accounts.save).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new@example.com',
      active: true,
    }));
    expect(redis.del).toHaveBeenCalledWith('sync:accounts:owner-1');
  });
});
