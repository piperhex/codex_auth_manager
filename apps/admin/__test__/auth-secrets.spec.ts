import { describe, expect, it } from 'vitest';
import {
  getKongJwtSecret,
  getRefreshSecret,
  validateAuthSecrets,
} from '@/config/auth-secrets';

describe('auth secret configuration', () => {
  it('allows missing secrets outside production', () => {
    expect(() => validateAuthSecrets({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => validateAuthSecrets({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => validateAuthSecrets({})).not.toThrow();
  });

  it('accepts trimmed, non-default production secrets', () => {
    expect(() => validateAuthSecrets({
      NODE_ENV: ' Production ',
      KONG_JWT_SECRET: ' kong-production ',
      JWT_REFRESH_SECRET: ' refresh-production ',
    })).not.toThrow();
  });

  it.each([
    [{ NODE_ENV: 'production' }, 'KONG_JWT_SECRET, JWT_REFRESH_SECRET'],
    [{
      NODE_ENV: 'production',
      KONG_JWT_SECRET: 'change-me-kong-jwt-secret',
      JWT_REFRESH_SECRET: 'valid-refresh',
    }, 'KONG_JWT_SECRET'],
    [{
      NODE_ENV: 'production',
      KONG_JWT_SECRET: 'valid-kong',
      JWT_REFRESH_SECRET: '   ',
    }, 'JWT_REFRESH_SECRET'],
  ])('rejects insecure production configuration %#', (config, expected) => {
    expect(() => validateAuthSecrets(config)).toThrow(expected as string);
  });

  it('uses trimmed configured secrets and development fallbacks', () => {
    expect(getKongJwtSecret({ KONG_JWT_SECRET: '  kong-secret  ' })).toBe('kong-secret');
    expect(getRefreshSecret({ JWT_REFRESH_SECRET: '  refresh-secret  ' })).toBe('refresh-secret');
    expect(getKongJwtSecret({ KONG_JWT_SECRET: '  ' })).toBe('change-me-kong-jwt-secret');
    expect(getRefreshSecret({})).toBe('replace-with-refresh-secret');
  });
});
