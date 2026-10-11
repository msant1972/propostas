import type { PrismaClient } from '@cpq/db';
import { compileProposal, type DocumentRepository } from '@cpq/documents';
import type { WorkerConfig } from '../config.js';
import { appendFromEvent, eventHandlers } from '../notify/events.js';
import type { Notifier } from '../notify/notifier.js';
import { makeReceipt, sendInvite } from '../notify/portal.js';

export interface OutboxJob {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** O que cada processador pode usar: base de dados, repositório de documentos, notificador e configuração. */
export interface HandlerContext {
  prisma: PrismaClient;
  repo: DocumentRepository;
  notifier: Notifier;
  cfg: WorkerConfig;
}

export type Handler = (job: OutboxJob, ctx: HandlerContext) => Promise<void>;

/** Eventos `audit.*` seguem para uma fila própria com concorrência 1: a cadeia de hashes tem um só escritor. */
export const isAuditEvent = (eventType: string) => eventType.startsWith('audit.');

/** Registo de processadores por tipo de evento. */
export const handlers = new Map<string, Handler>([
  ['system.ping', async () => undefined],
  ['system.fail', async () => {
    throw new Error('falha simulada');
  }],
  ['quote.locked', async () => undefined],
  ['proposal.sent', async () => undefined],
  ['proposal.cancelled', async () => undefined],
  ['portal.invite', async (job, ctx) => sendInvite(ctx, job.aggregateId, job.payload)],
  ['portal.receipt', async (job, ctx) => makeReceipt(ctx, job.aggregateId, job.payload)],
  ['audit.record', async (job, ctx) => appendFromEvent(ctx.prisma, job.payload)],
  ['document.compile', async (job, ctx) => {
    await compileProposal(ctx.prisma, ctx.repo, {
      proposalId: job.aggregateId,
      requestedBy: (job.payload['requestedBy'] as string | undefined) ?? null,
    });
  }],
  ...Object.entries(eventHandlers).map(([type, fn]): [string, Handler] => [
    type,
    (job, ctx) => fn({ prisma: ctx.prisma, notifier: ctx.notifier, cfg: ctx.cfg }, job.aggregateId, job.payload),
  ]),
]);

export class UnknownEventError extends Error {}

export async function dispatch(job: OutboxJob, ctx: HandlerContext): Promise<void> {
  const h = handlers.get(job.eventType);
  if (!h) throw new UnknownEventError(`Sem processador para ${job.eventType}`);
  await h(job, ctx);
}
