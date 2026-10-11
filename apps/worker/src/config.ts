import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  DOCUMENT_STORAGE_DIR: z.string().default('./storage'),
  AUDIT_EXPORT_DIR: z.string().default('./storage-audit'),
  MAIL_OUTBOX_DIR: z.string().default('./mail-outbox'),
  SMTP_URL: z.string().optional(), // ex.: smtp://user:pass@servidor:587; sem isto, as mensagens ficam em ficheiros .eml
  MAIL_FROM: z.string().default('propostas@localhost'),
  TLS_CERT_FILE: z.string().optional(), // impressão digital do certificado autoassinado nas mensagens ao cliente
  RETENTION_IP_DAYS: z.coerce.number().int().min(1).default(365), // IP e agente de utilizador das respostas do portal
  RETENTION_LINK_DAYS: z.coerce.number().int().min(1).default(180), // ligações expiradas e sem resposta
  TEAMS_WEBHOOK_URL: z.string().url().refine((u) => u.startsWith('https://'), 'TEAMS_WEBHOOK_URL tem de usar https').optional(), // só HTTPS (evita pedidos para destinos internos em claro)
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  RELAY_INTERVAL_MS: z.coerce.number().int().default(1000),
  RELAY_BATCH: z.coerce.number().int().default(100),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().default(8),
  OUTBOX_STALE_MINUTES: z.coerce.number().int().default(10),
  SCHEDULER_ENABLED: z.coerce.boolean().default(true),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(raw: Record<string, unknown> = process.env): WorkerConfig {
  return schema.parse(raw);
}
