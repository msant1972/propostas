import { Module } from '@nestjs/common';
import { ProposalsModule } from '../proposals/proposals.module.js';
import { PortalPublicController, ShareLinksController } from './portal.controller.js';
import { PortalService } from './portal.service.js';

@Module({ imports: [ProposalsModule], controllers: [PortalPublicController, ShareLinksController], providers: [PortalService] })
export class PortalModule {}
