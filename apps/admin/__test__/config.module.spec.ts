import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigModule } from '@/config/config.module';
import { MODULE_OPTIONS_TOKEN } from '@/config/configurable';
import type { ConfigModuleOptions } from '@/config/config.types';

const originalEnv = { ...process.env };
const tempDirectories: string[] = [];

function getConfig(path?: string, overrides: ConfigModuleOptions = {}) {
  const module = ConfigModule.register({ path, ...overrides });
  const provider = module.providers?.find(
    (candidate) => typeof candidate === 'object' && candidate && 'provide' in candidate
      && candidate.provide === MODULE_OPTIONS_TOKEN,
  );
  if (!provider || !('useValue' in provider)) throw new Error('Config provider was not registered');
  return provider.useValue as ConfigModuleOptions & { path?: string };
}

afterEach(() => {
  process.env = { ...originalEnv };
  while (tempDirectories.length) rmSync(tempDirectories.pop()!, { recursive: true, force: true });
});

describe('ConfigModule.register', () => {
  it('merges dotenv, explicit options and environment in precedence order', () => {
    const directory = mkdtempSync(join(tmpdir(), 'codex-switch-config-'));
    tempDirectories.push(directory);
    const path = join(directory, '.env');
    writeFileSync(path, 'POSTGRES_HOST=file-host\nPOSTGRES_PORT=1111\n');
    process.env.POSTGRES_PORT = '3333';

    const config = getConfig(path, { POSTGRES_HOST: 'option-host', REDIS_PORT: '7777' });

    expect(config.POSTGRES_HOST).toBe('option-host');
    expect(config.POSTGRES_PORT).toBe('3333');
    expect(config.REDIS_PORT).toBe('7777');
    expect(config.path).toBe(path);
  });

  it('works when the configured dotenv file does not exist', () => {
    process.env.REDIS_HOST = 'environment-host';
    expect(getConfig('missing.env').REDIS_HOST).toBe('environment-host');
  });

  it('validates the final merged production secrets', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.KONG_JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    expect(() => getConfig()).toThrow('Refusing to start in production');
  });
});
