import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPrisma, migrate, testDatabase, type PrismaClient } from '@cpq/db';
import { hashPassword, uuidv7 } from '@cpq/shared';
import type { Role } from '@cpq/shared/roles';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';

export const TEST_DB = process.env['TEST_DATABASE_URL'];
export const TEST_PASSWORD = 'Teste-Pass-2026!';

export interface Harness {
  app: INestApplication;
  prisma: PrismaClient;
  http: () => ReturnType<typeof request>;
  /** Cria (ou atualiza) um utilizador de teste e devolve o seu email. */
  makeUser: (o: { role: Role; key?: string; name?: string; teamId?: string | null; region?: string | null }) => Promise<{ id: string; email: string }>;
  /** Faz login com o email e a palavra-passe de teste e devolve o token. */
  login: (email: string, password?: string) => Promise<string>;
  /** Atalho: cria o utilizador do papel (e chave) e devolve o token. */
  token: (role: Role, key?: string) => Promise<string>;
  close: () => Promise<void>;
}

let hash: Promise<string> | undefined;

export async function boot(): Promise<Harness> {
  const url = await testDatabase(TEST_DB!, 'api');
  await migrate(url, 'up');
  process.env['DATABASE_URL'] = url;
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  const prisma = createPrisma(url);
  const http = () => request(app.getHttpServer());

  const makeUser: Harness['makeUser'] = async ({ role, key = 'default', name, teamId = null, region = null }) => {
    const email = `${role.toLowerCase()}.${key}@teste.pt`;
    hash ??= hashPassword(TEST_PASSWORD);
    const data = { displayName: name ?? `U ${role} ${key}`, rolesJson: [role], teamId, region, isActive: true, passwordHash: await hash, mustChangePassword: false, failedLogins: 0, lockedUntil: null };
    const u = await prisma.user.upsert({ where: { email }, update: data, create: { id: uuidv7(), email, ...data } });
    return { id: u.id, email };
  };
  const login: Harness['login'] = async (email, password = TEST_PASSWORD) => {
    const r = await http().post('/api/v1/auth/login').send({ email, password }).expect(201);
    return r.body.accessToken as string;
  };
  const token: Harness['token'] = async (role, key) => login((await makeUser({ role, key })).email);

  return { app, prisma, http, makeUser, login, token, close: async () => { await app.close(); await prisma.$disconnect(); } };
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
