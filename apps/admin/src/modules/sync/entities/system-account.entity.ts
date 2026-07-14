import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SystemAccountBindingEntity } from './system-account-binding.entity';

@Entity({ name: 'system_accounts' })
@Index(['syncAccountId'], { unique: true })
export class SystemAccountEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  /** Stable account id used by desktop sync. */
  @Column({ type: 'varchar', length: 64 })
  syncAccountId: string;

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

  @Column({ type: 'jsonb', default: {} })
  usage: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  auth: Record<string, unknown>;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastModifiedAt: Date;

  @OneToMany(() => SystemAccountBindingEntity, (binding) => binding.account)
  bindings: SystemAccountBindingEntity[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
