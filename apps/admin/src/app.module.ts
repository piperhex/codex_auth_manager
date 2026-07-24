import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ConfigModule } from '@/config/config.module';
import { PostgresqlModule } from '@/database/postgresql.module';
import { AdminModule } from '@/modules/admin/admin.module';
import { AnnouncementModule } from '@/modules/announcement/announcement.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { RedisModule } from '@/modules/redis/redis.module';
import { SyncModule } from '@/modules/sync/sync.module';
import { TelemetryModule } from '@/modules/telemetry/telemetry.module';
import { FeedbackModule } from '@/modules/feedback/feedback.module';
import { UserModule } from '@/modules/user/user.module';
import { RbacModule } from '@/common/rbac/rbac.module';
import { DashboardModule } from '@/modules/dashboard/dashboard.module';
import { DeviceModule } from '@/modules/devices/device.module';

@Module({
  imports: [
    ConfigModule.register({
      path: join(process.cwd(), '.env'),
    }),
    PostgresqlModule,
    RedisModule,
    RbacModule,
    UserModule,
    JwtConfigModule,
    AuthModule,
    SyncModule,
    AdminModule,
    AnnouncementModule,
    TelemetryModule,
    FeedbackModule,
    DashboardModule,
    DeviceModule,
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'public'),
      // API misses must remain API 404 responses. Without these exclusions,
      // ServeStatic falls back to public/index.html for an unknown API route,
      // masking version mismatches as an ENOENT filesystem error.
      exclude: [
        '/auth/{*any}',
        '/sync/{*any}',
        '/admin/api/{*any}',
        '/announcements/{*any}',
        '/notifications/{*any}',
        '/feedback/{*any}',
        '/telemetry/{*any}',
        '/devices/{*any}',
        '/device-switch/{*any}',
      ],
    }),
  ],
})
export class AppModule {}
