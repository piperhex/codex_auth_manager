import { CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { UserEntity } from '@/modules/user/entities/user.entity';
import { SystemAccountEntity } from './system-account.entity';

@Entity({ name: 'system_account_bindings' })
@Index(['userId'])
export class SystemAccountBindingEntity {
  @PrimaryColumn({ type: 'uuid' })
  systemAccountId: string;

  @ManyToOne(() => SystemAccountEntity, (account) => account.bindings, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'systemAccountId' })
  account: SystemAccountEntity;

  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => UserEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: UserEntity;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
