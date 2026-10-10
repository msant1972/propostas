import { Module } from '@nestjs/common';
import { isRole, type Role } from '@cpq/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { TOKEN_VERIFIER } from './auth.guard.js';
import { DevAuthController } from './dev-auth.controller.js';
import { MeController } from './me.controller.js';
import { DevTokenVerifier, EntraTokenVerifier } from './token-verifier.js';

const DEV_SECRET = process.env['DEV_JWT_SECRET'] ?? 'cpq-dev-secret-nao-usar-em-producao-0123456789';

export function createVerifier(env: Env) {
  if (env.AUTH_MODE === 'entra') {
    const raw = env.ENTRA_GROUP_ROLE_MAP ? (JSON.parse(env.ENTRA_GROUP_ROLE_MAP) as Record<string, string>) : {};
    const groupRoleMap = Object.fromEntries(Object.entries(raw).filter(([, r]) => isRole(r))) as Record<string, Role>;
    return new EntraTokenVerifier({ tenantId: env.ENTRA_TENANT_ID!, audience: env.ENTRA_AUDIENCE!, groupRoleMap });
  }
  return new DevTokenVerifier(DEV_SECRET);
}

@Module({
  controllers: [DevAuthController, MeController],
  providers: [
    { provide: TOKEN_VERIFIER, inject: [ENV], useFactory: createVerifier },
  ],
  exports: [TOKEN_VERIFIER],
})
export class AuthModule {}
