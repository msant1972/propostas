import { Inject, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
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
        getTracker: (req: Record<string, any>) => (req['principal']?.oid as string | undefined) ?? (req['ip'] as string | undefined) ?? 'anon',
      }),
    }),
    AuthModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: ProblemFilter },
    // Ordem importa: autenticar primeiro, para o limite ser por utilizador.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
