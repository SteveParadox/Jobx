import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    env: {
      APP_ENV: 'test',
      DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/fixture',
      REDIS_URL: 'redis://localhost:6379',
      AUTH_SECRET: 'test-secret-at-least-thirty-two-characters',
      SITE_URL: 'http://localhost:3000',
    },
  },
});
