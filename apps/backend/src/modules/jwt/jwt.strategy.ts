import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import { getKongJwtSecret } from '@/config/auth-secrets';
import type { ConfigModuleOptions } from '@/config/config.types';
import { UserService } from '@/modules/user/user.service';
import type { AuthUser } from '@/common/decorators/user.decorator';

interface AccessPayload {
  sub: string;
  email: string;
  role: 'user' | 'admin';
  iss: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(MODULE_OPTIONS_TOKEN) config: ConfigModuleOptions,
    private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getKongJwtSecret(config),
    });
  }

  async validate(payload: AccessPayload): Promise<AuthUser> {
    const user = await this.userService.findActiveById(payload.sub);
    if (!user) throw new UnauthorizedException('User is disabled or no longer exists');
    return { id: user.id, email: user.email, role: user.role };
  }
}
