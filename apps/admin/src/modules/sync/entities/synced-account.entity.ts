import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserEntity } from '@/modules/user/entities/user.entity';

@Entity({ name: 'synced_accounts' })
@Index(['ownerId', 'accountId'], { unique: true })
export class SyncedAccountEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => UserEntity, (user) => user.syncedAccounts, { onDelete: 'CASCADE' })
  owner: UserEntity;

  @Column({ type: 'varchar', length: 64 })
  accountId: string;

  @Column({ type: 'varchar', length: 240 })
  email: string;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ type: 'varchar', length: 40, default: '' })
  expiresAt: string;

  @Column({ type: 'varchar', length: 80, default: 'ChatGPT' })
  plan: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  codexAccountId?: string | null;

  @Column({ type: 'boolean', default: false })
  active: boolean;

  @Column({ type: 'jsonb', default: {} })
  usage: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastModifiedAt: Date;

  @Column({ type: 'jsonb', default: {} })
  fieldModifiedAt: Record<string, string>;

  @Column({ type: 'jsonb' })
  auth: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
