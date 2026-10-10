export interface OutboxJob {
  eventId: string;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export type Handler = (job: OutboxJob) => Promise<void>;

/** Registo de processadores por tipo de evento. As fases seguintes acrescentam Graph, documentos, etc. */
export const handlers = new Map<string, Handler>([
  ['system.ping', async () => undefined],
  ['system.fail', async () => {
    throw new Error('falha simulada');
  }],
]);

export class UnknownEventError extends Error {}

export async function dispatch(job: OutboxJob): Promise<void> {
  const h = handlers.get(job.eventType);
  if (!h) throw new UnknownEventError(`Sem processador para ${job.eventType}`);
  await h(job);
}
