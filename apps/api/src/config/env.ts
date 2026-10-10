import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),
    AUTH_MODE: z.enum(['dev', 'entra']).default('dev'),
    ENTRA_TENANT_ID: z.string().optional(),
    ENTRA_AUDIENCE: z.string().optional(),
    ENTRA_GROUP_ROLE_MAP: z.string().optional(), // JSON: {"<group-oid>": "Comercial"}
    DOCUMENT_STORAGE_DIR: z.string().default('./storage'), // repositório documental: pasta local do servidor
    ISSUER_COUNTRY: z.string().length(2).default('PT'), // país da entidade emitente (determina o IVA)
    THROTTLE_LIMIT: z.coerce.number().int().default(120),
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
      ctx.addIssue({ code: 'custom', message: 'AUTH_MODE=dev não é permitido em produção' });
    }
    if (env.AUTH_MODE === 'entra' && (!env.ENTRA_TENANT_ID || !env.ENTRA_AUDIENCE)) {
      ctx.addIssue({ code: 'custom', message: 'ENTRA_TENANT_ID e ENTRA_AUDIENCE são obrigatórios' });
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
