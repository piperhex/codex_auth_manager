import { createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, ILike, In, IsNull, Repository } from 'typeorm';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';
import { PutSyncAccountsDto, SyncAccountDto } from './dto/sync-accounts.dto';
import { PutSyncProvidersDto, SyncProviderDto } from './dto/sync-providers.dto';
import { SyncedAccountEntity } from './entities/synced-account.entity';
import { SyncedProviderEntity } from './entities/synced-provider.entity';
import { SystemAccountBindingEntity } from './entities/system-account-binding.entity';
import { SystemAccountEntity } from './entities/system-account.entity';

export type AdminSyncAccountDto = SyncAccountDto & {
  source: 'personal' | 'system';
  systemAccountId?: string;
};

export type PortalSyncAccountDto = Omit<AdminSyncAccountDto, 'auth'>;

type AccountFieldModifiedAt = {
  auth: string;
  note: string;
  expiresAt: string;
  usage: string;
  active: string;
};

interface AccountMergeResult {
  account: Partial<SyncedAccountEntity>;
  activeApplied: boolean;
}

export interface SystemAccountDto {
  id: string;
  syncAccountId: string;
  email: string;
  note: string;
  expiresAt: string;
  plan: string;
  accountId?: string | null;
  usage: Record<string, unknown>;
  lastModifiedAt: string;
  boundUserCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemAccountInput {
  auth: Record<string, unknown>;
  note?: string;
  expiresAt?: string;
  usage?: Record<string, unknown>;
}

export interface SystemAccountPatch {
  auth?: Record<string, unknown>;
  note?: string;
  expiresAt?: string;
  usage?: Record<string, unknown>;
}

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(SyncedAccountEntity)
    private readonly accounts: Repository<SyncedAccountEntity>,
    @InjectRepository(SyncedProviderEntity)
    private readonly providers: Repository<SyncedProviderEntity>,
    @InjectRepository(SystemAccountEntity)
    private readonly systemAccounts: Repository<SystemAccountEntity>,
    @InjectRepository(SystemAccountBindingEntity)
    private readonly systemBindings: Repository<SystemAccountBindingEntity>,
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(ownerId: string) {
    const cacheKey = this.cacheKey(ownerId);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        accounts: SyncAccountDto[];
        deletedAccountIds?: string[];
      };
      return { ...parsed, deletedAccountIds: parsed.deletedAccountIds ?? [] };
    }

    const payload = await this.loadEffectiveAccountState(ownerId);
    await this.redis.set(cacheKey, JSON.stringify(payload), 'EX', 60);
    return payload;
  }

  async replace(ownerId: string, dto: PutSyncAccountsDto) {
    const managedIds = await this.boundSystemSyncIds(ownerId);
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedAccountEntity);
      if (!dto.accounts.length) return;
      for (const account of dto.accounts) {
        if (managedIds.has(account.id)) continue;
        const existing = await repo.findOne({ where: { ownerId, accountId: account.id } });
        const merged = this.mergeIncomingAccount(existing, ownerId, account);
        if (!merged) continue;
        if (merged.activeApplied && merged.account.active) {
          await repo.update({ ownerId }, { active: false });
        }
        await repo.save(repo.create(merged.account));
      }
    });
    await this.redis.del(this.cacheKey(ownerId));
    return { count: dto.accounts.length };
  }

  async upsert(ownerId: string, accountId: string, account: SyncAccountDto) {
    if (account.id !== accountId) {
      throw new BadRequestException('Route account id does not match request body');
    }
    if (await this.isSystemAccountBound(ownerId, accountId)) {
      return { id: accountId };
    }
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SyncedAccountEntity);
      const existing = await repo.findOne({ where: { ownerId, accountId } });
      const merged = this.mergeIncomingAccount(existing, ownerId, account);
      if (!merged) return;
      if (merged.activeApplied && merged.account.active) {
        await repo.update({ ownerId }, { active: false });
      }
      await repo.save(repo.create(merged.account));
    });
    await this.redis.del(this.cacheKey(ownerId));
    return { id: accountId };
  }

  async delete(ownerId: string, accountId: string) {
    const bindings = await this.loadSystemBindings(ownerId);
    const binding = bindings.find((item) => item.account.syncAccountId === accountId);
    const deletedAt = new Date();
    if (binding) {
      await this.markAccountDeleted(ownerId, accountId, deletedAt, binding.account);
      await this.systemBindings.delete({
        systemAccountId: binding.systemAccountId,
        userId: ownerId,
      });
      await this.redis.del(this.cacheKey(ownerId));
      return { id: accountId };
    }
    await this.accounts.update({ ownerId, accountId }, { active: false, deletedAt });
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
    return {
      accounts: (await this.loadEffectiveAccountState(ownerId)).accounts.map((row) => {
        const { auth: _auth, ...account } = row;
        return account;
      }),
    };
  }

  async listForAdmin(ownerId: string): Promise<{ accounts: AdminSyncAccountDto[] }> {
    const [personalRows, bindings] = await Promise.all([
      this.accounts.find({ where: { ownerId, deletedAt: IsNull() }, order: { email: 'ASC' } }),
      this.loadSystemBindings(ownerId),
    ]);
    const effective = new Map<string, AdminSyncAccountDto>();
    for (const row of personalRows) {
      const account = this.toDto(row);
      effective.set(account.id, { ...account, source: 'personal' });
    }
    for (const binding of bindings) {
      const account = this.systemAccountToSyncDto(binding.account);
      effective.set(account.id, {
        ...account,
        source: 'system',
        systemAccountId: binding.systemAccountId,
      });
    }
    return {
      accounts: [...effective.values()].sort((left, right) => left.email.localeCompare(right.email)),
    };
  }

  async listForPortal(ownerId: string): Promise<{ accounts: PortalSyncAccountDto[] }> {
    const data = await this.listForAdmin(ownerId);
    return {
      accounts: data.accounts.map(({ auth: _auth, ...account }) => account),
    };
  }

  async countSystemAccountBindingsByUserIds(userIds: string[]) {
    const uniqueUserIds = [...new Set(userIds)];
    const counts = new Map<string, number>();
    if (!uniqueUserIds.length) return counts;

    const bindings = await this.systemBindings.find({
      where: { userId: In(uniqueUserIds) },
    });
    for (const binding of bindings) {
      counts.set(binding.userId, (counts.get(binding.userId) ?? 0) + 1);
    }
    return counts;
  }

  async listSystemAccounts(
    page = 1,
    pageSize = 20,
    search?: string,
    sortBy: 'createdAt' | 'boundUserCount' = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    const normalizedSearch = search?.trim();
    const where = normalizedSearch
      ? [
        { email: ILike(`%${normalizedSearch}%`) },
        { note: ILike(`%${normalizedSearch}%`) },
        { plan: ILike(`%${normalizedSearch}%`) },
      ]
      : undefined;

    if (sortBy === 'boundUserCount') {
      const query = this.systemAccounts
        .createQueryBuilder('account')
        .select('account.id', 'id')
        .addSelect('COUNT(binding.userId)', 'boundUserCount')
        .leftJoin('account.bindings', 'binding')
        .groupBy('account.id')
        .orderBy('"boundUserCount"', sortOrder === 'asc' ? 'ASC' : 'DESC')
        .addOrderBy('account.createdAt', 'DESC')
        .offset((page - 1) * pageSize)
        .limit(pageSize);
      if (normalizedSearch) {
        query.where(
          '(account.email ILIKE :search OR account.note ILIKE :search OR account.plan ILIKE :search)',
          { search: `%${normalizedSearch}%` },
        );
      }

      const [rows, total] = await Promise.all([
        query.getRawMany<{ id: string }>(),
        this.systemAccounts.count({ where }),
      ]);
      const ids = rows.map((row) => row.id);
      if (!ids.length) return { items: [], total, page, pageSize };

      const accounts = await this.systemAccounts.find({
        where: { id: In(ids) },
        relations: { bindings: true },
      });
      const byId = new Map(accounts.map((account) => [account.id, account]));
      return {
        items: ids
          .map((id) => byId.get(id))
          .filter((account): account is SystemAccountEntity => Boolean(account))
          .map((account) => this.presentSystemAccount(account)),
        total,
        page,
        pageSize,
      };
    }

    const [items, total] = await this.systemAccounts.findAndCount({
      where,
      relations: { bindings: true },
      order: { createdAt: sortOrder === 'asc' ? 'ASC' : 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: items.map((account) => this.presentSystemAccount(account)),
      total,
      page,
      pageSize,
    };
  }

  async createSystemAccount(input: SystemAccountInput) {
    const identity = this.systemAccountIdentity(input.auth);
    const existing = await this.systemAccounts.findOne({
      where: { syncAccountId: identity.syncAccountId },
    });
    if (existing) throw new ConflictException('Official account already exists in the system pool');
    const account = this.systemAccounts.create({
      ...identity,
      auth: input.auth,
      note: input.note?.trim() ?? '',
      expiresAt: input.expiresAt?.trim() ?? '',
      usage: input.usage ?? {},
      lastModifiedAt: new Date(),
    });
    const saved = await this.systemAccounts.save(account);
    return this.presentSystemAccount({ ...saved, bindings: [] });
  }

  async createSystemAccountFromPersonal(ownerId: string, accountId: string) {
    const account = await this.accounts.findOne({
      where: { ownerId, accountId, deletedAt: IsNull() },
    });
    if (!account) throw new NotFoundException('Synced account not found');
    return this.createSystemAccount({
      auth: account.auth,
      note: account.note,
      expiresAt: account.expiresAt,
      usage: account.usage,
    });
  }

  async updateSystemAccount(id: string, patch: SystemAccountPatch) {
    const account = await this.systemAccounts.findOne({
      where: { id },
      relations: { bindings: true },
    });
    if (!account) throw new NotFoundException('Official account not found');
    if (patch.auth !== undefined) {
      const identity = this.systemAccountIdentity(patch.auth);
      const duplicate = await this.systemAccounts.findOne({
        where: { syncAccountId: identity.syncAccountId },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException('Official account already exists in the system pool');
      }
      account.auth = patch.auth;
      account.syncAccountId = identity.syncAccountId;
      account.email = identity.email;
      account.plan = identity.plan;
      account.codexAccountId = identity.codexAccountId;
    }
    if (patch.note !== undefined) account.note = patch.note.trim();
    if (patch.expiresAt !== undefined) account.expiresAt = patch.expiresAt.trim();
    if (patch.usage !== undefined) account.usage = patch.usage;
    account.lastModifiedAt = new Date();
    const saved = await this.systemAccounts.save(account);
    await this.invalidateAccountCaches(account.bindings.map((binding) => binding.userId));
    return this.presentSystemAccount(saved);
  }

  async deleteSystemAccount(id: string) {
    const account = await this.systemAccounts.findOne({
      where: { id },
      relations: { bindings: true },
    });
    if (!account) throw new NotFoundException('Official account not found');
    const userIds = account.bindings.map((binding) => binding.userId);
    await this.systemAccounts.delete({ id });
    await this.invalidateAccountCaches(userIds);
    return { id };
  }

  async listSystemAccountBindingIds(id: string) {
    await this.requireSystemAccounts([id]);
    const bindings = await this.systemBindings.find({
      where: { systemAccountId: id },
      order: { createdAt: 'ASC' },
    });
    return { userIds: bindings.map((binding) => binding.userId) };
  }

  async bindSystemAccounts(systemAccountIds: string[], userIds: string[]) {
    const accountIds = [...new Set(systemAccountIds)];
    const targetUserIds = [...new Set(userIds)];
    await this.requireSystemAccounts(accountIds);
    const existing = await this.systemBindings.find({
      where: {
        systemAccountId: In(accountIds),
        userId: In(targetUserIds),
      },
    });
    const existingKeys = new Set(
      existing.map((binding) => `${binding.systemAccountId}:${binding.userId}`),
    );
    const additions = accountIds.flatMap((systemAccountId) => targetUserIds
      .filter((userId) => !existingKeys.has(`${systemAccountId}:${userId}`))
      .map((userId) => this.systemBindings.create({ systemAccountId, userId })));
    if (additions.length) await this.systemBindings.save(additions);
    await this.invalidateAccountCaches(targetUserIds);
    return { count: additions.length };
  }

  async unbindSystemAccounts(systemAccountIds: string[], userIds: string[]) {
    const accountIds = [...new Set(systemAccountIds)];
    const targetUserIds = [...new Set(userIds)];
    await this.requireSystemAccounts(accountIds);
    const result = await this.systemBindings.delete({
      systemAccountId: In(accountIds),
      userId: In(targetUserIds),
    });
    await this.invalidateAccountCaches(targetUserIds);
    return { count: result.affected ?? 0 };
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
    if (await this.isSystemAccountBound(ownerId, accountId)) {
      throw new BadRequestException('System pool accounts must be edited from the official account pool');
    }
    const account = await this.accounts.findOne({
      where: { ownerId, accountId, deletedAt: IsNull() },
    });
    if (!account) throw new NotFoundException('Synced account not found');
    const fieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      account.fieldModifiedAt,
      this.formatLastModifiedAt(account.lastModifiedAt ?? account.updatedAt),
    );
    const modifiedAt = this.formatLastModifiedAt(
      patch.lastModifiedAt === undefined ? new Date() : this.parseLastModifiedAt(patch.lastModifiedAt),
    );
    if (patch.active === true) {
      await this.accounts.update({ ownerId }, { active: false });
    }
    if (patch.email !== undefined) account.email = patch.email;
    if (patch.plan !== undefined) account.plan = patch.plan;
    if (patch.accountId !== undefined) account.codexAccountId = patch.accountId ?? null;
    if (patch.auth !== undefined) account.auth = patch.auth;
    if (patch.email !== undefined || patch.plan !== undefined || patch.accountId !== undefined || patch.auth !== undefined) {
      fieldModifiedAt.auth = modifiedAt;
    }
    if (patch.note !== undefined) {
      account.note = patch.note ?? '';
      fieldModifiedAt.note = modifiedAt;
    }
    if (patch.expiresAt !== undefined) {
      account.expiresAt = patch.expiresAt ?? '';
      fieldModifiedAt.expiresAt = modifiedAt;
    }
    if (patch.usage !== undefined) {
      account.usage = patch.usage ?? {};
      fieldModifiedAt.usage = modifiedAt;
    }
    if (patch.active !== undefined) {
      account.active = patch.active;
      fieldModifiedAt.active = modifiedAt;
    }
    account.fieldModifiedAt = fieldModifiedAt;
    account.lastModifiedAt = this.latestAccountFieldModifiedAt(fieldModifiedAt);
    const saved = await this.accounts.save(account);
    await this.redis.del(this.cacheKey(ownerId));
    return this.toDto(saved);
  }

  private mergeIncomingAccount(
    existing: SyncedAccountEntity | null,
    ownerId: string,
    incoming: SyncAccountDto,
  ): AccountMergeResult | null {
    const incomingFieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      incoming.fieldModifiedAt,
      incoming.lastModifiedAt,
    );
    const incomingLastModifiedAt = this.latestAccountFieldModifiedAt(incomingFieldModifiedAt);
    if (existing?.deletedAt) return null;
    if (!existing) {
      return {
        activeApplied: true,
        account: {
          id: undefined,
          ownerId,
          accountId: incoming.id,
          email: incoming.email,
          note: incoming.note ?? '',
          expiresAt: incoming.expiresAt ?? '',
          plan: incoming.plan,
          codexAccountId: incoming.accountId ?? null,
          active: incoming.active,
          usage: incoming.usage ?? {},
          auth: incoming.auth,
          deletedAt: null,
          fieldModifiedAt: incomingFieldModifiedAt,
          lastModifiedAt: incomingLastModifiedAt,
        },
      };
    }

    const existingFieldModifiedAt = this.normalizeAccountFieldModifiedAt(
      existing.fieldModifiedAt,
      this.formatLastModifiedAt(existing.lastModifiedAt ?? existing.updatedAt),
    );
    const incomingHasFieldVersions = Object.values(incoming.fieldModifiedAt ?? {})
      .some((value) => typeof value === 'string' && value.trim().length > 0);
    const existingHasFieldVersions = Object.values(existing.fieldModifiedAt ?? {})
      .some((value) => typeof value === 'string' && value.trim().length > 0);
    const account: Partial<SyncedAccountEntity> = {
      id: existing.id,
      ownerId,
      accountId: incoming.id,
      email: existing.email,
      note: existing.note,
      expiresAt: existing.expiresAt,
      plan: existing.plan,
      codexAccountId: existing.codexAccountId ?? null,
      active: existing.active,
      usage: existing.usage,
      auth: existing.auth,
      deletedAt: null,
      lastModifiedAt: existing.lastModifiedAt,
      fieldModifiedAt: { ...existingFieldModifiedAt },
    };
    let changed = false;
    let activeApplied = false;
    if (this.isIncomingFieldNewer(existingFieldModifiedAt.auth, incomingFieldModifiedAt.auth)) {
      account.email = incoming.email;
      account.plan = incoming.plan;
      account.codexAccountId = incoming.accountId ?? null;
      account.auth = incoming.auth;
      account.fieldModifiedAt!.auth = incomingFieldModifiedAt.auth;
      changed = true;
    }
    // Legacy desktop clients only send one account-wide timestamp. Once an account has
    // field-level versions, letting that legacy timestamp update metadata would recreate the
    // usage-refresh-overwrites-note bug. Preserve note and expiration until that client updates.
    if ((incomingHasFieldVersions || !existingHasFieldVersions)
      && this.isIncomingFieldNewer(existingFieldModifiedAt.note, incomingFieldModifiedAt.note)) {
      account.note = incoming.note ?? '';
      account.fieldModifiedAt!.note = incomingFieldModifiedAt.note;
      changed = true;
    }
    if ((incomingHasFieldVersions || !existingHasFieldVersions)
      && this.isIncomingFieldNewer(existingFieldModifiedAt.expiresAt, incomingFieldModifiedAt.expiresAt)) {
      account.expiresAt = incoming.expiresAt ?? '';
      account.fieldModifiedAt!.expiresAt = incomingFieldModifiedAt.expiresAt;
      changed = true;
    }
    if (this.isIncomingFieldNewer(existingFieldModifiedAt.usage, incomingFieldModifiedAt.usage)) {
      account.usage = incoming.usage ?? {};
      account.fieldModifiedAt!.usage = incomingFieldModifiedAt.usage;
      changed = true;
    }
    if (this.isIncomingFieldNewer(existingFieldModifiedAt.active, incomingFieldModifiedAt.active)) {
      account.active = incoming.active;
      account.fieldModifiedAt!.active = incomingFieldModifiedAt.active;
      activeApplied = true;
      changed = true;
    }
    if (!changed) return null;
    account.lastModifiedAt = this.latestAccountFieldModifiedAt(account.fieldModifiedAt!);
    return { account, activeApplied };
  }

  private normalizeAccountFieldModifiedAt(
    value: Partial<AccountFieldModifiedAt> | undefined,
    fallback: string | undefined,
  ): AccountFieldModifiedAt {
    const defaultValue = this.formatLastModifiedAt(this.parseLastModifiedAt(fallback));
    return {
      auth: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.auth ?? defaultValue)),
      note: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.note ?? defaultValue)),
      expiresAt: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.expiresAt ?? defaultValue)),
      usage: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.usage ?? defaultValue)),
      active: this.formatLastModifiedAt(this.parseLastModifiedAt(value?.active ?? defaultValue)),
    };
  }

  private isIncomingFieldNewer(existing: string, incoming: string) {
    return this.parseLastModifiedAt(incoming) > this.parseLastModifiedAt(existing);
  }

  private latestAccountFieldModifiedAt(values: Partial<AccountFieldModifiedAt>) {
    return new Date(Math.max(
      this.parseLastModifiedAt(values.auth).getTime(),
      this.parseLastModifiedAt(values.note).getTime(),
      this.parseLastModifiedAt(values.expiresAt).getTime(),
      this.parseLastModifiedAt(values.usage).getTime(),
      this.parseLastModifiedAt(values.active).getTime(),
    ));
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
      fieldModifiedAt: this.normalizeAccountFieldModifiedAt(
        row.fieldModifiedAt,
        this.formatLastModifiedAt(row.lastModifiedAt ?? row.updatedAt),
      ),
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

  private async loadEffectiveAccountState(ownerId: string) {
    const [personalRows, bindings] = await Promise.all([
      this.accounts.find({ where: { ownerId }, order: { email: 'ASC' } }),
      this.loadSystemBindings(ownerId),
    ]);
    const deletedAccountIds = new Set(personalRows
      .filter((row) => Boolean(row.deletedAt))
      .map((row) => row.accountId));
    const effective = new Map(personalRows.filter((row) => !row.deletedAt).map((row) => {
      const account = this.toDto(row);
      return [account.id, account] as const;
    }));
    for (const binding of bindings) {
      const account = this.systemAccountToSyncDto(binding.account);
      effective.set(account.id, account);
      deletedAccountIds.delete(account.id);
    }
    return {
      accounts: [...effective.values()].sort((left, right) => left.email.localeCompare(right.email)),
      deletedAccountIds: [...deletedAccountIds].sort(),
    };
  }

  private async markAccountDeleted(
    ownerId: string,
    accountId: string,
    deletedAt: Date,
    systemAccount?: SystemAccountEntity,
  ) {
    const existing = await this.accounts.findOne({ where: { ownerId, accountId } });
    if (existing) {
      await this.accounts.update({ ownerId, accountId }, { active: false, deletedAt });
      return;
    }
    if (!systemAccount) return;
    const fallbackModifiedAt = this.formatLastModifiedAt(
      systemAccount.lastModifiedAt ?? systemAccount.updatedAt,
    );
    await this.accounts.save(this.accounts.create({
      ownerId,
      accountId,
      email: systemAccount.email,
      note: systemAccount.note,
      expiresAt: systemAccount.expiresAt,
      plan: systemAccount.plan,
      codexAccountId: systemAccount.codexAccountId ?? null,
      active: false,
      usage: systemAccount.usage,
      auth: systemAccount.auth,
      fieldModifiedAt: this.normalizeAccountFieldModifiedAt(undefined, fallbackModifiedAt),
      lastModifiedAt: systemAccount.lastModifiedAt ?? systemAccount.updatedAt,
      deletedAt,
    }));
  }

  private loadSystemBindings(ownerId: string) {
    return this.systemBindings.find({
      where: { userId: ownerId },
      relations: { account: true },
    });
  }

  private async boundSystemSyncIds(ownerId: string) {
    const bindings = await this.loadSystemBindings(ownerId);
    return new Set(bindings.map((binding) => binding.account.syncAccountId));
  }

  private async isSystemAccountBound(ownerId: string, syncAccountId: string) {
    const bindings = await this.loadSystemBindings(ownerId);
    return bindings.some((binding) => binding.account.syncAccountId === syncAccountId);
  }

  private systemAccountToSyncDto(account: SystemAccountEntity): SyncAccountDto {
    return {
      id: account.syncAccountId,
      email: account.email,
      note: account.note,
      expiresAt: account.expiresAt,
      plan: account.plan,
      accountId: account.codexAccountId,
      active: false,
      usage: account.usage,
      lastModifiedAt: this.formatLastModifiedAt(account.lastModifiedAt ?? account.updatedAt),
      auth: account.auth,
    };
  }

  private presentSystemAccount(account: SystemAccountEntity): SystemAccountDto {
    return {
      id: account.id,
      syncAccountId: account.syncAccountId,
      email: account.email,
      note: account.note,
      expiresAt: account.expiresAt,
      plan: account.plan,
      accountId: account.codexAccountId,
      usage: account.usage,
      lastModifiedAt: this.formatLastModifiedAt(account.lastModifiedAt ?? account.updatedAt),
      boundUserCount: account.bindings?.length ?? 0,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  }

  private systemAccountIdentity(auth: Record<string, unknown>) {
    if (!auth || Array.isArray(auth)) {
      throw new BadRequestException('auth.json must be a JSON object');
    }
    const tokens = this.objectValue(auth.tokens);
    const accessToken = this.stringValue(tokens?.access_token);
    if (!accessToken) throw new BadRequestException('auth.json is missing tokens.access_token');
    const identityToken = this.stringValue(tokens?.id_token) ?? accessToken;
    const payloadPart = identityToken.split('.')[1];
    if (!payloadPart) throw new BadRequestException('auth.json contains an invalid ChatGPT token');
    let claims: Record<string, unknown>;
    try {
      claims = this.objectValue(JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')))
        ?? {};
    } catch {
      throw new BadRequestException('auth.json contains an invalid ChatGPT token');
    }
    const nested = this.objectValue(claims['https://api.openai.com/auth']);
    const profile = this.objectValue(claims['https://api.openai.com/profile']);
    const email = this.stringValue(claims.email)
      ?? this.stringValue(profile?.email)
      ?? 'Unknown account';
    const plan = this.stringValue(nested?.chatgpt_plan_type) ?? 'ChatGPT';
    const codexAccountId = this.stringValue(tokens?.account_id)
      ?? this.stringValue(nested?.chatgpt_account_id)
      ?? null;
    const identity = this.stringValue(nested?.chatgpt_user_id)
      ?? this.stringValue(nested?.user_id)
      ?? this.stringValue(claims.sub)
      ?? email;
    if (email.length > 240 || plan.length > 80 || (codexAccountId?.length ?? 0) > 160) {
      throw new BadRequestException('Official account identity exceeds the supported length');
    }
    const syncAccountId = createHash('sha256')
      .update(identity)
      .update('\0')
      .update(codexAccountId ?? 'personal')
      .digest()
      .subarray(0, 12)
      .toString('hex');
    return { syncAccountId, email, plan, codexAccountId };
  }

  private objectValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  }

  private stringValue(value: unknown) {
    return typeof value === 'string' && value.length ? value : undefined;
  }

  private async requireSystemAccounts(ids: string[]) {
    const accounts = await this.systemAccounts.find({ where: { id: In(ids) } });
    if (accounts.length !== ids.length) throw new NotFoundException('Official account not found');
    return accounts;
  }

  private async invalidateAccountCaches(userIds: string[]) {
    const keys = [...new Set(userIds)].map((userId) => this.cacheKey(userId));
    if (keys.length) await this.redis.del(...keys);
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
