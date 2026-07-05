import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '@/modules/admin/admin.module';
import { JwtConfigModule } from '@/modules/jwt/jwt.module';
import { UserModule } from '@/modules/user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RefreshTokenEntity } from './entities/refresh-token.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RefreshTokenEntity]), UserModule, JwtConfigModule, AdminModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
