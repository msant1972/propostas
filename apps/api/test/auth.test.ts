import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/setup.js';

let app: INestApplication;

beforeAll(async () => {
  process.env['DATABASE_URL'] = 'mysql://x';
  process.env['AUTH_MODE'] = 'dev';
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = mod.createNestApplication();
  configureApp(app);
  await app.init();
});

afterAll(() => app.close());

describe('autenticação', () => {
  it('health é público', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
  });

  it('401 em problem+json sem token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 401 });
  });

  it('emite token de desenvolvimento e valida o corpo', async () => {
    const bad = await request(app.getHttpServer()).post('/api/v1/dev/token').send({ oid: 'u1', roles: ['Hacker'] });
    expect(bad.status).toBe(400);
    const ok = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ oid: 'u1', email: 'a@x.pt', name: 'Ana', roles: ['Comercial'] })
      .expect(201);
    expect(ok.body.accessToken).toBeTypeOf('string');
  });

  it('devolve o utilizador autenticado com o token de desenvolvimento', async () => {
    const t = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ oid: 'u1', email: 'a@x.pt', name: 'Ana', roles: ['Comercial'] });
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${t.body.accessToken}`)
      .expect(200);
    expect(res.body).toMatchObject({ oid: 'u1', roles: ['Comercial'] });
  });

  it('rejeita token adulterado', async () => {
    await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
  });

  it('envia cabeçalhos de segurança', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
