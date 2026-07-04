import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { UserModule } from '@/modules/user/user.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), UserModule],
  providers: [JwtStrategy],
  exports: [JwtModule, PassportModule],
})
export class JwtConfigModule {}
