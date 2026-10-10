import { Module } from '@nestjs/common';
import { CatalogLoader } from './catalog-loader.js';

@Module({ providers: [CatalogLoader], exports: [CatalogLoader] })
export class CpqModule {}
