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

@Entity({ name: 'synced_providers' })
@Index(['ownerId', 'providerId'], { unique: true })
export class SyncedProviderEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid' })
  ownerId: string;

  @ManyToOne(() => UserEntity, (user) => user.syncedProviders, { onDelete: 'CASCADE' })
  owner: UserEntity;

  @Column({ type: 'varchar', length: 64 })
  providerId: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Column({ type: 'varchar', length: 500 })
  baseUrl: string;

  @Column({ type: 'text' })
  apiKey: string;

  @Column({ type: 'varchar', length: 160 })
  model: string;

  @Column({ type: 'jsonb', default: [] })
  models: string[];

  @Column({ type: 'boolean', default: false })
  modelSelectionControlledByCodex: boolean;

  @Column({ type: 'varchar', length: 24 })
  apiFormat: 'openaiResponses' | 'openaiChat';

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastModifiedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
