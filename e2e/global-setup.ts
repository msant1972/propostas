import { resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

let worker: ChildProcess | undefined;

/** O worker não tem porta HTTP: arranca-se aqui, para os testes de geração de documentos terem quem os processe. */
export default async function globalSetup() {
  worker = spawn('pnpm', ['--filter', '@cpq/worker', 'dev'], { stdio: 'ignore', env: { ...process.env, DATABASE_URL: process.env['DATABASE_URL'] ?? 'mysql://cpq:cpq@127.0.0.1:3306/cpq_dev', DOCUMENT_STORAGE_DIR: process.env['DOCUMENT_STORAGE_DIR'] ?? resolve(import.meta.dirname, '../storage'), REDIS_URL: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379' }, detached: false });
  await new Promise((r) => setTimeout(r, 4000));
  return async () => {
    worker?.kill('SIGTERM');
    spawn('pkill', ['-f', 'apps/worker']).on('error', () => undefined);
  };
}
