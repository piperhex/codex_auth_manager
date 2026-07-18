import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity({ name: 'rbac_permissions' })
export class RbacPermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  code: string;

  @Column({ type: 'varchar', length: 60 })
  group: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 500, default: '' })
  description: string;

  @Column({ type: 'boolean', default: false })
  system: boolean;
}
