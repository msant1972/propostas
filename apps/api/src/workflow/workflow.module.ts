import { Module } from '@nestjs/common';
import { ProposalsModule } from '../proposals/proposals.module.js';
import { ApprovalsService } from './approvals.service.js';
import { WorkflowController } from './workflow.controller.js';
import { WorkflowService } from './workflow.service.js';

@Module({
  imports: [ProposalsModule],
  controllers: [WorkflowController],
  providers: [WorkflowService, ApprovalsService],
  exports: [WorkflowService, ApprovalsService],
})
export class WorkflowModule {}
