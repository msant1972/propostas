import { Module } from '@nestjs/common';
import { LocalDocumentRepository } from '@cpq/documents';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CpqModule } from '../cpq/cpq.module.js';
import { DOCUMENT_REPO, DocumentsService } from './documents.service.js';
import { DocumentsController } from './documents.controller.js';
import { ProposalsController } from './proposals.controller.js';
import { ProposalsService } from './proposals.service.js';
import { QuotesService } from './quotes.service.js';
import { SectionsService } from './sections.service.js';

@Module({
  imports: [CpqModule],
  controllers: [ProposalsController, DocumentsController],
  providers: [
    ProposalsService, QuotesService, SectionsService, DocumentsService,
    { provide: DOCUMENT_REPO, inject: [ENV], useFactory: (env: Env) => new LocalDocumentRepository(env.DOCUMENT_STORAGE_DIR) },
  ],
  exports: [ProposalsService, QuotesService, DocumentsService, DOCUMENT_REPO],
})
export class ProposalsModule {}
