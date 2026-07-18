import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'device_installations' })
export class DeviceInstallationEntity {
  @PrimaryColumn({ type: 'uuid' })
  deviceId: string;

  @Column({ type: 'varchar', length: 20 })
  platform: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  appVersion: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  firstSeenAt: Date;
}
