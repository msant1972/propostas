import 'reflect-metadata';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma, migrate, testDatabase, type PrismaClient } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { loadConfig } from '../src/config.js';
import { dispatch, type OutboxJob } from '../src/queues/handlers.js';
import { Notifier } from '../src/notify/notifier.js';
import { OutboxRelay } from '../src/relay/relay.service.js';

const DB = process.env['TEST_DATABASE_URL'];
const REDIS = process.env['TEST_REDIS_URL'];
const run = describe.skipIf(!DB || !REDIS);

async function until(cond: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('tempo esgotado à espera da condição');
}

run('relay do outbox com MariaDB e Redis', () => {
  let prisma: PrismaClient;
  let redis: Redis;
  let queue: Queue<OutboxJob>;
  let auditQueue: Queue<OutboxJob>;
  let worker: Worker<OutboxJob>;
  let relay: OutboxRelay;
  const queueName = `events-test-${uuidv7()}`;
  let cfg: ReturnType<typeof loadConfig>;

  const add = (eventType: string, over: Record<string, unknown> = {}) => {
    const id = uuidv7();
    return prisma.outboxEvent.create({ data: { id, aggregateId: uuidv7(), eventType, payload: { n: 1 }, ...over } });
  };

  beforeAll(async () => {
    const url = await testDatabase(DB!, 'worker');
    cfg = loadConfig({ DATABASE_URL: url, OUTBOX_MAX_ATTEMPTS: '2', OUTBOX_STALE_MINUTES: '10' });
    await migrate(url, 'up');
    prisma = createPrisma(url);
    await prisma.outboxEvent.deleteMany();
    redis = new Redis(REDIS!, { maxRetriesPerRequest: null });
    queue = new Queue<OutboxJob>(queueName, { connection: redis });
    const audit = new Queue<OutboxJob>(`${queueName}-audit`, { connection: redis });
    auditQueue = audit;
    relay = new OutboxRelay(prisma, { events: queue, audit }, cfg);
    worker = new Worker<OutboxJob>(queueName, async (job) => dispatch(job.data, { prisma, repo: undefined as never, notifier: new Notifier(cfg), cfg }), { connection: redis.duplicate() });
    worker.on('completed', (job) => void relay.markDone(job.data.eventId));
    worker.on('failed', (job, err) => { if (job) void relay.markFailed(job.data.eventId, err); });
  });

  afterAll(async () => {
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    await auditQueue?.close();
    await redis?.quit();
    await prisma?.$disconnect();
  });

  it('um evento PENDING é publicado, processado e passa a DONE', async () => {
    const ev = await add('system.ping');
    expect(await relay.tick()).toBeGreaterThanOrEqual(1);
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status === 'DONE');
  });

  it('uma falha incrementa as tentativas, agenda de novo e esgota em FAILED', async () => {
    const ev = await add('system.fail');
    await relay.tick();
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).attempts === 1);
    const first = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(first.status).toBe('PENDING');
    expect(first.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // forçamos a data para já e repetimos: com 2 tentativas máximas, passa a FAILED
    await prisma.outboxEvent.update({ where: { id: ev.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await relay.tick();
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status === 'FAILED');
  });

  it('eventos sem processador falham em vez de ficarem presos', async () => {
    const ev = await add('tipo.desconhecido');
    await relay.tick();
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).attempts >= 1);
  });

  it('não reclama eventos com data futura nem duas vezes o mesmo evento', async () => {
    const future = await add('system.ping', { nextAttemptAt: new Date(Date.now() + 60_000) });
    await relay.tick();
    expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: future.id } })).status).toBe('PENDING');

    const ev = await add('system.ping');
    const [a, b] = await Promise.all([new OutboxRelay(prisma, { events: queue, audit: auditQueue }, cfg).tick(), new OutboxRelay(prisma, { events: queue, audit: auditQueue }, cfg).tick()]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status === 'DONE');
  });

  it('eventos presos em PROCESSING há muito tempo voltam a PENDING e são processados', async () => {
    const ev = await add('system.ping', { status: 'PROCESSING', nextAttemptAt: new Date(Date.now() - 3_600_000) });
    await relay.tick();
    await until(async () => (await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } })).status === 'DONE');
  });
});
