import { z } from 'zod';

const DEV_SECRET = 'cpq-segredo-so-para-desenvolvimento-nao-usar-em-producao-0123456789';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    /** Segredo que assina os tokens de sessão (HS256). Obrigatório e forte em produção. */
    AUTH_JWT_SECRET: z.string().optional(),
    AUTH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(8),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).default(5),
    LOGIN_RATE_PER_MINUTE: z.coerce.number().int().min(1).default(10), // pedidos de login por IP e por minuto
    LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),
    DOCUMENT_STORAGE_DIR: z.string().default('./storage'), // repositório documental: pasta local do servidor
    ISSUER_COUNTRY: z.string().length(2).default('PT'), // país da entidade emitente (determina o IVA)
    PORTAL_BASE_URL: z.string().default('http://localhost:5173'), // base das ligações do portal do cliente
    THROTTLE_LIMIT: z.coerce.number().int().default(120),
  })
  .transform((env) => ({ ...env, AUTH_JWT_SECRET: env.AUTH_JWT_SECRET ?? (env.NODE_ENV === 'production' ? '' : DEV_SECRET) }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.AUTH_JWT_SECRET.length < 32) ctx.addIssue({ code: 'custom', message: 'AUTH_JWT_SECRET é obrigatório em produção (mínimo 32 caracteres)' });
      if (env.AUTH_JWT_SECRET === DEV_SECRET) ctx.addIssue({ code: 'custom', message: 'AUTH_JWT_SECRET não pode ser o segredo de desenvolvimento' });
    } else if (env.AUTH_JWT_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', message: 'AUTH_JWT_SECRET tem de ter pelo menos 32 caracteres' });
    }
  });

export type Env = z.infer<typeof schema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Configuração inválida: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  return parsed.data;
}
