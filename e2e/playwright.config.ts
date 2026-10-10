import { defineConfig } from '@playwright/test';

const databaseUrl = process.env['DATABASE_URL'] ?? 'mysql://cpq:cpq@127.0.0.1:3306/cpq_dev';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @cpq/api dev',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: true,
      env: { DATABASE_URL: databaseUrl, AUTH_MODE: 'dev', PORT: '3000' },
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @cpq/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
