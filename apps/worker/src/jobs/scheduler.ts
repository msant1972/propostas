import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@cpq/db';
import type { DocumentRepository } from '@cpq/documents';
import type { WorkerConfig } from '../config.js';
import { runAuditExport, runChainVerification, runExpiry, runManualEditCheck, runSlaEscalation } from './scheduled.js';

/**
 * Tarefas periódicas. Cada execução toma um *lock* no Redis, para que, com vários workers, só um a faça.
 * Se uma tarefa falhar, regista o erro e tenta de novo no ciclo seguinte.
 */
export function startScheduler(deps: { prisma: PrismaClient; repo: DocumentRepository; cfg: WorkerConfig; redis: Redis }): () => void {
  const log = new Logger('Scheduler');
  const { prisma, repo, cfg, redis } = deps;

  const every = (name: string, ms: number, fn: () => Promise<unknown>) => {
    const run = async () => {
      const got = await redis.set(`cpq:job:${name}`, '1', 'PX', Math.floor(ms * 0.9), 'NX');
      if (got !== 'OK') return;
      try {
        const r = await fn();
        if (r && (Array.isArray(r) ? r.length : typeof r === 'number' ? r : 1)) log.log(`${name}: ${JSON.stringify(r)}`);
      } catch (e) {
        log.error(`${name} falhou: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    void run();
    return setInterval(() => void run(), ms);
  };

  const timers = [
    every('sla', 60_000, () => runSlaEscalation(prisma)),
    every('expiry', 3_600_000, () => runExpiry(prisma)),
    every('manual-edits', 900_000, () => runManualEditCheck(prisma, repo)),
    every('audit-verify', 6 * 3_600_000, () => runChainVerification(prisma)),
    every('audit-export', 6 * 3_600_000, () => runAuditExport(prisma, cfg)),
  ];
  return () => timers.forEach(clearInterval);
}
