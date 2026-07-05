import type { ConfigModuleOptions } from './config.types';

const DEVELOPMENT_KONG_JWT_SECRET = 'change-me-kong-jwt-secret';
const DEVELOPMENT_REFRESH_SECRET = 'replace-with-refresh-secret';

const insecureProductionSecrets: Record<'KONG_JWT_SECRET' | 'JWT_REFRESH_SECRET', string> = {
  KONG_JWT_SECRET: DEVELOPMENT_KONG_JWT_SECRET,
  JWT_REFRESH_SECRET: DEVELOPMENT_REFRESH_SECRET,
};

export function validateAuthSecrets(config: ConfigModuleOptions): void {
  if (config.NODE_ENV?.trim().toLowerCase() !== 'production') return;

  const invalidSecrets = Object.entries(insecureProductionSecrets)
    .filter(([key, insecureValue]) => {
      const value = config[key as keyof typeof insecureProductionSecrets];
      return !value?.trim() || value.trim() === insecureValue;
    })
    .map(([key]) => key);

  if (invalidSecrets.length > 0) {
    throw new Error(
      `Refusing to start in production: ${invalidSecrets.join(', ')} must be set to non-default values`,
    );
  }
}

export function getKongJwtSecret(config: ConfigModuleOptions): string {
  return config.KONG_JWT_SECRET?.trim() || DEVELOPMENT_KONG_JWT_SECRET;
}

export function getRefreshSecret(config: ConfigModuleOptions): string {
  return config.JWT_REFRESH_SECRET?.trim() || DEVELOPMENT_REFRESH_SECRET;
}
