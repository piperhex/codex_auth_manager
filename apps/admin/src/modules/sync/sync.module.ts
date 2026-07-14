import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncedAccountEntity } from './entities/synced-account.entity';
import { SyncedProviderEntity } from './entities/synced-provider.entity';
import { SystemAccountBindingEntity } from './entities/system-account-binding.entity';
import { SystemAccountEntity } from './entities/system-account.entity';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    SyncedAccountEntity,
    SyncedProviderEntity,
    SystemAccountEntity,
    SystemAccountBindingEntity,
  ])],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
