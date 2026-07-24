import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/common/rbac/rbac.module';
import { AdminAuditLogEntity } from '@/modules/admin/entities/admin-audit-log.entity';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { AnnouncementLinkClickEntity } from './entities/announcement-link-click.entity';
import { AppAnnouncementEntity } from './entities/app-announcement.entity';
import { AppNotificationEntity } from './entities/app-notification.entity';

@Module({
  imports: [
    JwtConfigModule,
    RbacModule,
    TypeOrmModule.forFeature([
      AppAnnouncementEntity,
      AppNotificationEntity,
      AnnouncementLinkClickEntity,
      AdminAuditLogEntity,
    ]),
  ],
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
})
export class AnnouncementModule {}
