import type { PrismaClient } from '@cpq/db';
import { compileProposal, type DocumentRepository } from '@cpq/documents';
import type { WorkerConfig } from '../config.js';

export interface OutboxJob {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** O que cada processador pode usar: base de dados, repositório de documentos e configuração. */
export interface HandlerContext {
  prisma: PrismaClient;
  repo: DocumentRepository;
  cfg: WorkerConfig;
}

export type Handler = (job: OutboxJob, ctx: HandlerContext) => Promise<void>;

/** Registo de processadores por tipo de evento. As fases seguintes acrescentam aprovações, notificações e auditoria. */
export const handlers = new Map<string, Handler>([
  ['system.ping', async () => undefined],
  ['system.fail', async () => {
    throw new Error('falha simulada');
  }],
  ['quote.locked', async () => undefined],
  ['document.compile', async (job, ctx) => {
    await compileProposal(ctx.prisma, ctx.repo, {
      proposalId: job.aggregateId,
      requestedBy: (job.payload['requestedBy'] as string | undefined) ?? null,
    });
  }],
]);

export class UnknownEventError extends Error {}

export async function dispatch(job: OutboxJob, ctx: HandlerContext): Promise<void> {
  const h = handlers.get(job.eventType);
  if (!h) throw new UnknownEventError(`Sem processador para ${job.eventType}`);
  await h(job, ctx);
}
