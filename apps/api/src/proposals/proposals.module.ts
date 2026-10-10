import { Module } from '@nestjs/common';
import { CpqModule } from '../cpq/cpq.module.js';
import { ProposalsController } from './proposals.controller.js';
import { ProposalsService } from './proposals.service.js';
import { QuotesService } from './quotes.service.js';

@Module({
  imports: [CpqModule],
  controllers: [ProposalsController],
  providers: [ProposalsService, QuotesService],
  exports: [ProposalsService, QuotesService],
})
export class ProposalsModule {}
