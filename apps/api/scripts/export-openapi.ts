import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { buildOpenApi, configureApp } from '../src/setup.js';

process.env['DATABASE_URL'] ??= 'mysql://cpq:cpq@127.0.0.1:3306/cpq_dev';

const app = await NestFactory.create(AppModule, { logger: false });
configureApp(app);
const doc = buildOpenApi(app);
writeFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), JSON.stringify(doc, null, 2) + '\n');
await app.close();
console.log('openapi.json escrito');
