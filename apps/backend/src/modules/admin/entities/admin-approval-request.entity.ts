import { randomUUID } from 'crypto';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AdminApprovalType = 'promote_user_to_admin';
export type AdminApprovalStatus = 'pending' | 'approved' | 'rejected';

@Entity({ name: 'admin_approval_requests' })
@Index(['status', 'createdAt'])
@Index(['targetUserId'])
export class AdminApprovalRequestEntity {
  @PrimaryColumn({ type: 'uuid' })
  id: string = randomUUID();

  @Column({ type: 'varchar', length: 60 })
  type: AdminApprovalType;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: AdminApprovalStatus;

  @Column({ type: 'uuid' })
  requestedById: string;

  @Column({ type: 'varchar', length: 160 })
  requestedByEmail: string;

  @Column({ type: 'uuid', nullable: true })
  reviewedById?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  reviewedByEmail?: string | null;

  @Column({ type: 'uuid' })
  targetUserId: string;

  @Column({ type: 'varchar', length: 160 })
  targetEmail: string;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'text', default: '' })
  comment: string;

  @Column({ type: 'text', default: '' })
  reviewComment: string;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt?: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
