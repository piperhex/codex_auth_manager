import { randomUUID } from 'crypto';
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity({ name: 'admin_audit_logs' })
@Index(['createdAt'])
@Index(['action'])
export class AdminAuditLogEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'uuid', nullable: true })
  actorId?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  actorEmail: string;

  @Column({ type: 'varchar', length: 80 })
  action: string;

  @Column({ type: 'varchar', length: 40 })
  targetType: string;

  @Column({ type: 'varchar', length: 160, nullable: true })
  targetId?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  targetEmail?: string | null;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
