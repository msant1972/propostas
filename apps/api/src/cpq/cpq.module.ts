import { Module } from '@nestjs/common';
import { CatalogLoader } from './catalog-loader.js';
import { CpqController } from './cpq.controller.js';

@Module({ controllers: [CpqController], providers: [CatalogLoader], exports: [CatalogLoader] })
export class CpqModule {}
