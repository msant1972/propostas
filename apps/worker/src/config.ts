import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  DOCUMENT_STORAGE_DIR: z.string().default('./storage'),
  RELAY_INTERVAL_MS: z.coerce.number().int().default(1000),
  RELAY_BATCH: z.coerce.number().int().default(100),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().default(8),
  OUTBOX_STALE_MINUTES: z.coerce.number().int().default(10),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(raw: Record<string, unknown> = process.env): WorkerConfig {
  return schema.parse(raw);
}
