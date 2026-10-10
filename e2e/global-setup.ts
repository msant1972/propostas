import { spawn, type ChildProcess } from 'node:child_process';

let worker: ChildProcess | undefined;

/** O worker não tem porta HTTP: arranca-se aqui, para os testes de geração de documentos terem quem os processe. */
export default async function globalSetup() {
  worker = spawn('pnpm', ['--filter', '@cpq/worker', 'dev'], { stdio: 'ignore', env: process.env, detached: false });
  await new Promise((r) => setTimeout(r, 4000));
  return async () => {
    worker?.kill('SIGTERM');
    spawn('pkill', ['-f', 'apps/worker']).on('error', () => undefined);
  };
}
