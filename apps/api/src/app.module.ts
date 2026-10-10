import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthzGuard } from './authz/authz.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { OutboxModule } from './outbox/outbox.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { UsersModule } from './users/users.module.js';
import { ProblemFilter } from './common/problem.filter.js';
import { AppConfigModule, ENV } from './config/config.module.js';
import type { Env } from './config/env.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ ttl: 60_000, limit: env.THROTTLE_LIMIT }],
        // Limite por utilizador autenticado; por IP enquanto anónimo.
        getTracker: (req: Record<string, unknown>) =>
          (req['principal'] as { oid?: string } | undefined)?.oid ?? (req['ip'] as string | undefined) ?? 'anon',
      }),
    }),
    PrismaModule,
    UsersModule,
    OutboxModule,
    AuthModule,
    CatalogModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    // Ordem importa: autenticar primeiro, para o limite ser por utilizador.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
