import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { Prisma, type PrismaClient } from '@cpq/db';
import type { WorkerConfig } from '../config.js';
import type { OutboxJob } from '../queues/handlers.js';
import { backoffMs } from './backoff.js';

interface Claimed {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: unknown;
}

/**
 * Passa eventos de `outbox_events` para o BullMQ. Vários workers podem correr em simultâneo:
 * `FOR UPDATE SKIP LOCKED` garante que cada evento é reclamado uma só vez.
 */
export class OutboxRelay {
  private readonly log = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly queue: Queue<OutboxJob>,
    private readonly cfg: WorkerConfig,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(String(e))), this.cfg.RELAY_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Um ciclo: recupera eventos presos, reclama pendentes e publica-os na fila. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      await this.requeueStale();
      const claimed = await this.claim();
      for (const e of claimed) {
        await this.queue.add(
          e.event_type,
          {
            eventId: e.id,
            eventType: e.event_type,
            aggregateId: e.aggregate_id,
            payload: (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) as Record<string, unknown>,
          },
          { jobId: e.id, removeOnComplete: true, removeOnFail: true, attempts: 1 },
        );
      }
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  /** Eventos em PROCESSING há demasiado tempo (worker caiu a meio) voltam a PENDING. */
  private async requeueStale(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_events SET status = 'PENDING'
      WHERE status = 'PROCESSING'
        AND next_attempt_at < (CURRENT_TIMESTAMP(6) - INTERVAL ${this.cfg.OUTBOX_STALE_MINUTES} MINUTE)`;
  }

  private claim(): Promise<Claimed[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Claimed[]>`
        SELECT id, event_type, aggregate_id, payload FROM outbox_events
        WHERE status = 'PENDING' AND next_attempt_at <= CURRENT_TIMESTAMP(6)
        ORDER BY created_at LIMIT ${this.cfg.RELAY_BATCH}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return rows;
      const ids = rows.map((r) => r.id);
      await tx.$executeRaw`
        UPDATE outbox_events SET status = 'PROCESSING', next_attempt_at = CURRENT_TIMESTAMP(6)
        WHERE id IN (${Prisma.join(ids)})`;
      return rows;
    });
  }

  async markDone(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({ where: { id: eventId }, data: { status: 'DONE' } });
  }

  /** Falha: incrementa tentativas e agenda com *backoff*; esgotadas, o evento passa a FAILED (gera alerta). */
  async markFailed(eventId: string, error: unknown): Promise<void> {
    const ev = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!ev) return;
    const attempts = ev.attempts + 1;
    const exhausted = attempts >= this.cfg.OUTBOX_MAX_ATTEMPTS;
    this.log.warn(`evento ${eventId} falhou (tentativa ${attempts}): ${String(error)}`);
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        attempts,
        status: exhausted ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
      },
    });
  }
}
