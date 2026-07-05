import { DynamicModule, Global, Module } from '@nestjs/common';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } from './configurable';
import { validateAuthSecrets } from './auth-secrets';
import type { ConfigModuleOptions, ConfigModuleRegister } from './config.types';

@Global()
@Module({})
export class ConfigModule extends ConfigurableModuleClass {
  static register(options: ConfigModuleRegister = {}): DynamicModule {
    let fileConfig: ConfigModuleOptions = {};
    if (options.path && fs.existsSync(options.path)) {
      fileConfig = dotenv.parse(fs.readFileSync(options.path, 'utf8'));
    }

    const config: ConfigModuleOptions = { ...fileConfig, ...options, ...process.env };
    validateAuthSecrets(config);

    return {
      module: ConfigModule,
      providers: [
        {
          provide: MODULE_OPTIONS_TOKEN,
          useValue: config,
        },
      ],
      exports: [MODULE_OPTIONS_TOKEN],
    };
  }
}
