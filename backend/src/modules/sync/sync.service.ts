import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { DataSource, Repository } from 'typeorm';
import { REDIS_CLIENT } from '@/modules/redis/redis.constants';
import { PutSyncAccountsDto, SyncAccountDto } from './dto/sync-accounts.dto';
import { SyncedAccountEntity } from './entities/synced-account.entity';

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(SyncedAccountEntity)
    private readonly accounts: Repository<SyncedAccountEntity>,
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
      await repo.delete({ ownerId });
      if (!dto.accounts.length) return;
      await repo.save(dto.accounts.map((account) => repo.create({
        ownerId,
        accountId: account.id,
        email: account.email,
        note: account.note ?? '',
        expiresAt: account.expiresAt ?? '',
        plan: account.plan,
        codexAccountId: account.accountId ?? null,
        active: account.active,
        usage: account.usage ?? {},
        auth: account.auth,
      })));
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
      if (account.active) {
        await repo.update({ ownerId }, { active: false });
      }
      const existing = await repo.findOne({ where: { ownerId, accountId } });
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
      auth: row.auth,
    };
  }

  private cacheKey(ownerId: string) {
    return `sync:accounts:${ownerId}`;
  }
}
