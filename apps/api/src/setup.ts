import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, raw, type NextFunction, type Request, type Response } from 'express';
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
  // Só se lê o corpo se o pedido trouxer um Bearer token (o AuthGuard valida-o a seguir): anónimos não fazem o servidor guardar 25 MB em memória.
  const rawBody = raw({ type: 'application/octet-stream', limit: '25mb' });
  app.use('/api/v1/proposals/:id/documents/upload', (req: Request, res: Response, next: NextFunction) =>
    /^bearer\s+\S+/i.test(req.headers.authorization ?? '') ? rawBody(req, res, next) : next(),
  );
  // Corpo JSON: 100 kB por omissão; conteúdos e secções levam imagens coladas (base64), por isso aceitam até 12 MB.
  // Como nos carregamentos, só se lê um corpo grande com Bearer token (o AuthGuard valida-o a seguir).
  const bigJson = json({ limit: '12mb' });
  const smallJson = json({ limit: '100kb' });
  const richPath = /^\/api\/v1\/(content\/blocks|proposals\/[^/]+\/sections)(\/|$)/;
  app.use((req: Request, res: Response, next: NextFunction) =>
    richPath.test(req.path) && /^bearer\s+\S+/i.test(req.headers.authorization ?? '') ? bigJson(req, res, next) : smallJson(req, res, next),
  );
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
