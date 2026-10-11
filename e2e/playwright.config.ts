import { resolve } from 'node:path';
import { envFileValue } from './env-file';
import { defineConfig } from '@playwright/test';

const databaseUrl = process.env['DATABASE_URL'] ?? 'mysql://cpq:cpq@127.0.0.1:3306/cpq_dev';
// a API e o worker partilham a mesma pasta de documentos (caminho absoluto: cada processo corre num diretório diferente)
export const storageDir = process.env['DOCUMENT_STORAGE_DIR'] ?? envFileValue('DOCUMENT_STORAGE_DIR') ?? resolve(import.meta.dirname, '../storage');

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  globalSetup: './global-setup.ts',
  workers: 1,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'pnpm --filter @cpq/api dev',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: true,
      env: { DATABASE_URL: databaseUrl, PORT: '3000', LOGIN_RATE_PER_MINUTE: '1000', DOCUMENT_STORAGE_DIR: storageDir },
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
