import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__test__/**/*.spec.ts'],
    setupFiles: ['__test__/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'src/config/auth-secrets.ts',
        'src/config/config.module.ts',
        'src/common/guards/admin.guard.ts',
        'src/modules/admin/admin.controller.ts',
        'src/modules/auth/auth.controller.ts',
        'src/modules/auth/auth.service.ts',
        'src/modules/jwt/jwt.strategy.ts',
        'src/modules/sync/sync.controller.ts',
        'src/modules/sync/sync.service.ts',
        'src/modules/user/user.service.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
