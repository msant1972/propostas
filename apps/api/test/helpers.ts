import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPrisma, migrate, testDatabase, type PrismaClient } from '@cpq/db';
import { DEV_USER_OIDS, type Role } from '@cpq/shared';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';

export const TEST_DB = process.env['TEST_DATABASE_URL'];

export interface Harness {
  app: INestApplication;
  prisma: PrismaClient;
  http: () => ReturnType<typeof request>;
  token: (role: Role, oid?: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function boot(): Promise<Harness> {
  const url = await testDatabase(TEST_DB!, 'api');
  await migrate(url, 'up');
  process.env['DATABASE_URL'] = url;
  process.env['AUTH_MODE'] = 'dev';
  process.env['THROTTLE_LIMIT'] = '100000';
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = createPrisma(url);
  const http = () => request(app.getHttpServer());
  const token = async (role: Role, oid = DEV_USER_OIDS[role]) => {
    const r = await http().post('/api/v1/dev/token').send({ oid, email: `${oid}@x.pt`, name: `U ${role}`, roles: [role] }).expect(201);
    return r.body.accessToken as string;
  };
  return { app, prisma, http, token, close: async () => { await app.close(); await prisma.$disconnect(); } };
}

/** Esvazia as tabelas da base de testes (cada ficheiro de testes começa limpo). */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const tables = (await prisma.$queryRawUnsafe<Array<{ t: string }>>(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> '_migrations'",
  )).map((r) => r.t);
  // O SET FOREIGN_KEY_CHECKS é por ligação: uma transação interativa fixa-nos numa só.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of tables) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  });
}
