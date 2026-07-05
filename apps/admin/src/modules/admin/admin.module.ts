import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncModule } from '@/modules/sync/sync.module';
import { UserModule } from '@/modules/user/user.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminApprovalRequestEntity } from './entities/admin-approval-request.entity';
import { AdminAuditLogEntity } from './entities/admin-audit-log.entity';
import { AdminInvitationEntity } from './entities/admin-invitation.entity';

@Module({
  imports: [
    UserModule,
    SyncModule,
    TypeOrmModule.forFeature([
      AdminApprovalRequestEntity,
      AdminAuditLogEntity,
      AdminInvitationEntity,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
