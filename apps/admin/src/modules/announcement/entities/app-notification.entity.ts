import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'app_notifications' })
export class AppNotificationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  titleZh: string;

  @Column({ type: 'varchar', length: 160 })
  titleEn: string;

  @Column({ type: 'text' })
  contentZh: string;

  @Column({ type: 'text' })
  contentEn: string;

  @Column({ type: 'varchar', length: 2048, default: '' })
  link: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  linkLabelZh: string;

  @Column({ type: 'varchar', length: 80, default: '' })
  linkLabelEn: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'timestamptz' })
  publishedAt: Date;

  @Column({ type: 'uuid', nullable: true })
  updatedById?: string | null;

  @Column({ type: 'varchar', length: 160, default: '' })
  updatedByEmail: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
