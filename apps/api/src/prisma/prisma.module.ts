import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPrisma, type PrismaClient } from '@cpq/db';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const PRISMA = Symbol('PRISMA');
export type Prisma = PrismaClient;

@Injectable()
class PrismaShutdown implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}
  async onApplicationShutdown() {
    await this.prisma.$disconnect();
  }
}

/** A ligação é aberta no primeiro pedido, por isso a aplicação arranca mesmo sem BD (ex.: exportar o OpenAPI). */
@Global()
@Module({
  providers: [
    { provide: PRISMA, inject: [ENV], useFactory: (env: Env) => createPrisma(env.DATABASE_URL) },
    PrismaShutdown,
  ],
  exports: [PRISMA],
})
export class PrismaModule {}
