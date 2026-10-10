import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createPrisma } from '@cpq/db';
import { LocalDocumentRepository } from '@cpq/documents';
import { loadConfig } from './config.js';
import { startScheduler } from './jobs/scheduler.js';
import { Notifier } from './notify/notifier.js';
import { dispatch, type OutboxJob } from './queues/handlers.js';
import { OutboxRelay } from './relay/relay.service.js';

const log = new Logger('Worker');
const cfg = loadConfig();
const prisma = createPrisma(cfg.DATABASE_URL);
const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });

const queues = {
  events: new Queue<OutboxJob>('events', { connection }),
  audit: new Queue<OutboxJob>('audit', { connection }),
};
const relay = new OutboxRelay(prisma, queues, cfg);
const ctx = { prisma, repo: new LocalDocumentRepository(cfg.DOCUMENT_STORAGE_DIR), notifier: new Notifier(cfg), cfg };

const make = (name: 'events' | 'audit', concurrency: number) => {
  const w = new Worker<OutboxJob>(name, async (job) => dispatch(job.data, ctx), { connection, concurrency });
  w.on('completed', (job) => void relay.markDone(job.data.eventId));
  w.on('failed', (job, err) => {
    if (job) void relay.markFailed(job.data.eventId, err);
  });
  return w;
};
// A fila de auditoria tem concorrência 1: a cadeia de hashes serializa-se aqui.
const workers = [make('events', 5), make('audit', 1)];

relay.start();
const stopScheduler = cfg.SCHEDULER_ENABLED ? startScheduler({ prisma, repo: ctx.repo, cfg, redis: connection }) : () => undefined;
log.log('Worker iniciado (relay do outbox, filas "events" e "audit", tarefas periódicas)');

async function shutdown() {
  log.log('A terminar…');
  relay.stop();
  stopScheduler();
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
