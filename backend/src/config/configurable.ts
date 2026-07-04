import { ConfigurableModuleBuilder } from '@nestjs/common';
import type { ConfigModuleOptions } from './config.types';

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
  new ConfigurableModuleBuilder<ConfigModuleOptions>().build();
