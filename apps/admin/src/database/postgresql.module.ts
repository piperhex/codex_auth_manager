import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [MODULE_OPTIONS_TOKEN],
      useFactory: (config: ConfigModuleOptions) => ({
        type: 'postgres',
        host: config.POSTGRES_HOST ?? '127.0.0.1',
        port: Number(config.POSTGRES_PORT ?? 5432),
        username: config.POSTGRES_USER ?? 'codex_switch',
        password: config.POSTGRES_PASSWORD ?? 'codex_switch',
        database: config.POSTGRES_DB ?? 'codex_switch',
        entities: [__dirname + '/../modules/**/*.entity{.ts,.js}'],
        autoLoadEntities: true,
        synchronize: (config.POSTGRES_DB_SYNCHRONIZE ?? 'false') === 'true',
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class PostgresqlModule {}
