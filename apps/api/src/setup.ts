import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { raw } from 'express';
import helmet from 'helmet';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

/** Configuração comum à aplicação real e aos testes. */
export function configureApp(app: INestApplication): void {
  const env = app.get<Env>(ENV);
  app.setGlobalPrefix('api/v1');
  // Atrás do Nginx (mesmo servidor): o IP do cliente vem em X-Forwarded-For, para o limite de pedidos e para o comprovativo.
  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: false });
  // Carregamento de documentos editados: corpo binário (até 25 MB), só nesta rota.
  app.use('/api/v1/proposals/:id/documents/upload', raw({ type: 'application/octet-stream', limit: '25mb' }));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}

export function buildOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('CPQ & Proposal Management API')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
