import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RbacModule } from '@/common/rbac/rbac.module';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { DeviceInstallationEntity } from './entities/device-installation.entity';
import { DeviceTelemetryEventEntity } from './entities/device-telemetry-event.entity';
import { TelemetryAdminController } from './telemetry-admin.controller';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [
    JwtConfigModule,
    RbacModule,
    TypeOrmModule.forFeature([DeviceInstallationEntity, DeviceTelemetryEventEntity]),
  ],
  controllers: [TelemetryController, TelemetryAdminController],
  providers: [TelemetryService],
})
export class TelemetryModule {}
