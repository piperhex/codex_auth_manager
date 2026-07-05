import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (config: ConfigModuleOptions) => new Redis({
        host: config.REDIS_HOST ?? '127.0.0.1',
        port: Number(config.REDIS_PORT ?? 6379),
        password: config.REDIS_PASSWORD || undefined,
      }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
