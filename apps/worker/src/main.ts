import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createPrisma } from '@cpq/db';
import { loadConfig } from './config.js';
import { dispatch, type OutboxJob } from './queues/handlers.js';
import { OutboxRelay } from './relay/relay.service.js';

const log = new Logger('Worker');
const cfg = loadConfig();
const prisma = createPrisma(cfg.DATABASE_URL);
const connection = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue<OutboxJob>('events', { connection });
const relay = new OutboxRelay(prisma, queue, cfg);

const worker = new Worker<OutboxJob>(
  'events',
  async (job) => {
    await dispatch(job.data);
  },
  { connection, concurrency: 5 },
);

worker.on('completed', (job) => void relay.markDone(job.data.eventId));
worker.on('failed', (job, err) => {
  if (job) void relay.markFailed(job.data.eventId, err);
});

relay.start();
log.log('Worker iniciado (relay do outbox + fila "events")');

async function shutdown() {
  log.log('A terminar…');
  relay.stop();
  await worker.close();
  await queue.close();
  await connection.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
