import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RefreshTokenEntity } from '@/modules/auth/entities/refresh-token.entity';
import { SyncedAccountEntity } from '@/modules/sync/entities/synced-account.entity';
import { SyncedProviderEntity } from '@/modules/sync/entities/synced-provider.entity';

export type UserRole = 'user' | 'admin';

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'varchar', length: 160, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 120, select: false })
  passwordHash: string;

  @Column({ type: 'varchar', length: 20, default: 'user' })
  role: UserRole;

  @Column({ type: 'boolean', default: false })
  disabled: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt?: Date | null;

  @OneToMany(() => RefreshTokenEntity, (token) => token.user)
  refreshTokens: RefreshTokenEntity[];

  @OneToMany(() => SyncedAccountEntity, (account) => account.owner)
  syncedAccounts: SyncedAccountEntity[];

  @OneToMany(() => SyncedProviderEntity, (provider) => provider.owner)
  syncedProviders: SyncedProviderEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
