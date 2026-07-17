import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'app_announcements' })
export class AppAnnouncementEntity {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  id: string;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'varchar', length: 7, default: '#C4D7C8' })
  textColor: string;

  @Column({ type: 'varchar', length: 7, default: '#203128' })
  backgroundColor: string;

  @Column({ type: 'integer', default: 22 })
  scrollDurationSeconds: number;

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
