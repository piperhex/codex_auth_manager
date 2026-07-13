import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';
import { PutSyncAccountsDto, SyncAccountDto } from './dto/sync-accounts.dto';
import { PutSyncProvidersDto, SyncProviderDto } from './dto/sync-providers.dto';
import { SyncedAccountEntity } from './entities/synced-account.entity';
import { SyncedProviderEntity } from './entities/synced-provider.entity';

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(SyncedAccountEntity)
    private readonly accounts: Repository<SyncedAccountEntity>,
    @InjectRepository(SyncedProviderEntity)
    private readonly providers: Repository<SyncedProviderEntity>,
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(ownerId: string) {
    const cacheKey = this.cacheKey(ownerId);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as { accounts: SyncAccountDto[] };

    const rows = await this.accounts.find({
      where: { ownerId },
      order: { email: 'ASC' },
    });
    const payload = { accounts: rows.map((row) => this.toDto(row)) };
    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', 60);
    return payload;
  }

  async replace(ownerId: string, dto: PutSyncAccountsDto) {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedAccountEntity);
      if (!dto.accounts.length) return;
      for (const account of dto.accounts) {
        const existing = await repo.findOne({ where: { ownerId, accountId: account.id } });
        const incomingLastModifiedAt = this.parseLastModifiedAt(account.lastModifiedAt);
        if (!this.shouldApplyIncoming(existing, incomingLastModifiedAt)) continue;
        if (account.active) {
          await repo.update({ ownerId }, { active: false });
        }
        await repo.save(repo.create({
          id: existing?.id,
          ownerId,
          accountId: account.id,
          email: account.email,
          note: account.note ?? '',
          expiresAt: account.expiresAt ?? '',
          plan: account.plan,
          codexAccountId: account.accountId ?? null,
          active: account.active,
          usage: account.usage ?? {},
          lastModifiedAt: incomingLastModifiedAt,
          auth: account.auth,
        }));
      }
    });
    await this.redis.del(this.cacheKey(ownerId));
    return { count: dto.accounts.length };
  }

  async upsert(ownerId: string, accountId: string, account: SyncAccountDto) {
    if (account.id !== accountId) {
      throw new BadRequestException('Route account id does not match request body');
    }
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedAccountEntity);
      const existing = await repo.findOne({ where: { ownerId, accountId } });
      const incomingLastModifiedAt = this.parseLastModifiedAt(account.lastModifiedAt);
      if (!this.shouldApplyIncoming(existing, incomingLastModifiedAt)) return;
      if (account.active) {
        await repo.update({ ownerId }, { active: false });
      }
      await repo.save(repo.create({
        id: existing?.id,
        ownerId,
        accountId: account.id,
        email: account.email,
        note: account.note ?? '',
        expiresAt: account.expiresAt ?? '',
        plan: account.plan,
        codexAccountId: account.accountId ?? null,
        active: account.active,
        usage: account.usage ?? {},
        lastModifiedAt: incomingLastModifiedAt,
        auth: account.auth,
      }));
    });
    await this.redis.del(this.cacheKey(ownerId));
    return { id: accountId };
  }

  async delete(ownerId: string, accountId: string) {
    await this.accounts.delete({ ownerId, accountId });
    await this.redis.del(this.cacheKey(ownerId));
    return { id: accountId };
  }

  async listProviders(ownerId: string) {
    const cacheKey = this.providerCacheKey(ownerId);
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as { providers: SyncProviderDto[] };

    const rows = await this.providers.find({
      where: { ownerId },
      order: { name: 'ASC' },
    });
    const payload = { providers: rows.map((row) => this.toProviderDto(row)) };
    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', 60);
    return payload;
  }

  async listSummary(ownerId: string) {
    const rows = await this.accounts.find({
      where: { ownerId },
      order: { email: 'ASC' },
    });
    return {
      accounts: rows.map((row) => {
        const { auth: _auth, ...account } = this.toDto(row);
        return account;
      }),
    };
  }

  async replaceProviders(ownerId: string, dto: PutSyncProvidersDto) {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedProviderEntity);
      if (!dto.providers.length) return;
      for (const provider of dto.providers) {
        const existing = await repo.findOne({ where: { ownerId, providerId: provider.id } });
        const incomingLastModifiedAt = this.parseLastModifiedAt(provider.lastModifiedAt);
        if (!this.shouldApplyProviderIncoming(existing, incomingLastModifiedAt)) continue;
        await repo.save(repo.create({
          id: existing?.id,
          ownerId,
          providerId: provider.id,
          name: provider.name,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          models: provider.models ?? [],
          modelSelectionControlledByCodex: provider.modelSelectionControlledByCodex ?? false,
          apiFormat: provider.apiFormat,
          lastModifiedAt: incomingLastModifiedAt,
        }));
      }
    });
    await this.redis.del(this.providerCacheKey(ownerId));
    return { count: dto.providers.length };
  }

  async upsertProvider(ownerId: string, providerId: string, provider: SyncProviderDto) {
    if (provider.id !== providerId) {
      throw new BadRequestException('Route provider id does not match request body');
    }
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedProviderEntity);
      const existing = await repo.findOne({ where: { ownerId, providerId } });
      const incomingLastModifiedAt = this.parseLastModifiedAt(provider.lastModifiedAt);
      if (!this.shouldApplyProviderIncoming(existing, incomingLastModifiedAt)) return;
      await repo.save(repo.create({
        id: existing?.id,
        ownerId,
        providerId: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        models: provider.models ?? [],
        modelSelectionControlledByCodex: provider.modelSelectionControlledByCodex ?? false,
        apiFormat: provider.apiFormat,
        lastModifiedAt: incomingLastModifiedAt,
      }));
    });
    await this.redis.del(this.providerCacheKey(ownerId));
    return { id: providerId };
  }

  async deleteProvider(ownerId: string, providerId: string) {
    await this.providers.delete({ ownerId, providerId });
    await this.redis.del(this.providerCacheKey(ownerId));
    return { id: providerId };
  }

  async updateForAdmin(
    ownerId: string,
    accountId: string,
    patch: Partial<SyncAccountDto>,
  ) {
    const account = await this.accounts.findOne({ where: { ownerId, accountId } });
    if (!account) throw new NotFoundException('Synced account not found');
    if (patch.active === true) {
      await this.accounts.update({ ownerId }, { active: false });
    }
    if (patch.email !== undefined) account.email = patch.email;
    if (patch.note !== undefined) account.note = patch.note ?? '';
    if (patch.expiresAt !== undefined) account.expiresAt = patch.expiresAt ?? '';
    if (patch.plan !== undefined) account.plan = patch.plan;
    if (patch.accountId !== undefined) account.codexAccountId = patch.accountId ?? null;
    if (patch.active !== undefined) account.active = patch.active;
    if (patch.usage !== undefined) account.usage = patch.usage ?? {};
    if (patch.lastModifiedAt !== undefined) {
      account.lastModifiedAt = this.parseLastModifiedAt(patch.lastModifiedAt);
    } else if (Object.keys(patch).some((key) => key !== 'lastModifiedAt')) {
      account.lastModifiedAt = new Date();
    }
    if (patch.auth !== undefined) account.auth = patch.auth;
    const saved = await this.accounts.save(account);
    await this.redis.del(this.cacheKey(ownerId));
    return this.toDto(saved);
  }

  private toDto(row: SyncedAccountEntity): SyncAccountDto {
    return {
      id: row.accountId,
      email: row.email,
      note: row.note,
      expiresAt: row.expiresAt,
      plan: row.plan,
      accountId: row.codexAccountId,
      active: row.active,
      usage: row.usage,
      lastModifiedAt: this.formatLastModifiedAt(row.lastModifiedAt ?? row.updatedAt),
      auth: row.auth,
    };
  }

  private toProviderDto(row: SyncedProviderEntity): SyncProviderDto {
    return {
      id: row.providerId,
      name: row.name,
      baseUrl: row.baseUrl,
      apiKey: row.apiKey,
      model: row.model,
      models: row.models ?? [],
      modelSelectionControlledByCodex: row.modelSelectionControlledByCodex,
      apiFormat: row.apiFormat,
      lastModifiedAt: this.formatLastModifiedAt(row.lastModifiedAt ?? row.updatedAt),
    };
  }

  private parseLastModifiedAt(value: string | undefined) {
    if (!value?.trim()) return new Date();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private shouldApplyIncoming(existing: SyncedAccountEntity | null, incomingLastModifiedAt: Date) {
    if (!existing) return true;
    const existingLastModifiedAt = this.existingLastModifiedAt(existing);
    return incomingLastModifiedAt > existingLastModifiedAt;
  }

  private shouldApplyProviderIncoming(
    existing: SyncedProviderEntity | null,
    incomingLastModifiedAt: Date,
  ) {
    if (!existing) return true;
    const existingLastModifiedAt = this.existingProviderLastModifiedAt(existing);
    return incomingLastModifiedAt > existingLastModifiedAt;
  }

  private existingLastModifiedAt(account: SyncedAccountEntity) {
    return this.parseDateOrEpoch(account.lastModifiedAt ?? account.updatedAt);
  }

  private existingProviderLastModifiedAt(provider: SyncedProviderEntity) {
    return this.parseDateOrEpoch(provider.lastModifiedAt ?? provider.updatedAt);
  }

  private parseDateOrEpoch(value: Date | string | undefined) {
    if (!value) return new Date(0);
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  }

  private formatLastModifiedAt(value: Date | string | undefined) {
    return this.parseDateOrEpoch(value).toISOString();
  }

  private cacheKey(ownerId: string) {
    return `sync:accounts:${ownerId}`;
  }

  private providerCacheKey(ownerId: string) {
    return `sync:providers:${ownerId}`;
  }
}
