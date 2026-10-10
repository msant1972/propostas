import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor, AppAbility } from '../authz/ability.js';
import { CheckAbility, CurrentAbility, CurrentActor } from '../authz/authz.js';
import { ApprovalsService } from './approvals.service.js';
import {
  ApprovalDetailDto, ApprovalSummaryDto, CreateDelegationDto, CreatePolicyDto, DecideDto, DelegationDto, PolicyDto, TimelineEntryDto,
  TransitionDto, TransitionResultDto, UpdatePolicyDto, UserOptionDto,
} from './workflow.dto.js';
import { WorkflowService } from './workflow.service.js';

@ApiTags('workflow')
@ApiBearerAuth()
@Controller()
export class WorkflowController {
  constructor(
    private readonly workflow: WorkflowService,
    private readonly approvals: ApprovalsService,
  ) {}

  // -- estado da proposta -----------------------------------------------------------------------
  @Get('proposals/:id/transitions') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'getTransitions', summary: 'Estado atual e ações possíveis' }) @ApiOkResponse({ type: TransitionResultDto })
  available(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility) {
    return this.workflow.available(id, ab);
  }

  @Post('proposals/:id/transitions') @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'transitionProposal', summary: 'Executa uma transição da máquina de estados' }) @ApiCreatedResponse({ type: TransitionResultDto })
  transition(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @CurrentAbility() ab: AppAbility, @Body() dto: TransitionDto) {
    return this.workflow.transition(id, actor, ab, dto);
  }

  @Get('proposals/:id/timeline') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'getTimeline', summary: 'Histórico auditado da proposta' }) @ApiOkResponse({ type: [TimelineEntryDto] })
  timeline(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility) {
    return this.workflow.timeline(id, ab);
  }

  // -- aprovações -------------------------------------------------------------------------------
  @Get('approvals') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listApprovals', summary: 'Pedidos que o utilizador pode decidir' }) @ApiOkResponse({ type: [ApprovalSummaryDto] })
  inbox(@CurrentActor() actor: Actor, @Query('all') all?: string) {
    return this.approvals.inbox(actor, all === 'true');
  }

  @Get('approvals/:id') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'getApproval' }) @ApiOkResponse({ type: ApprovalDetailDto })
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @CurrentAbility() ab: AppAbility) {
    return this.approvals.detail(id, actor, ab.can('read', 'Cost'));
  }

  @Post('approvals/:id/decision') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'decideApproval', summary: 'Aprova, rejeita ou devolve' }) @ApiCreatedResponse({ type: ApprovalDetailDto })
  decide(@Param('id', ParseUUIDPipe) id: string, @CurrentActor() actor: Actor, @Body() dto: DecideDto) {
    return this.approvals.decide(id, actor, dto);
  }

  // -- delegações -------------------------------------------------------------------------------
  @Get('delegations') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listDelegations' }) @ApiOkResponse({ type: [DelegationDto] })
  delegations(@CurrentActor() actor: Actor) {
    return this.approvals.listDelegations(actor);
  }

  @Get('delegations/targets') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listDelegationTargets' }) @ApiOkResponse({ type: [UserOptionDto] })
  targets(@CurrentActor() actor: Actor) {
    return this.approvals.delegationTargets(actor);
  }

  @Post('delegations') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'createDelegation' }) @ApiCreatedResponse({ type: DelegationDto })
  createDelegation(@CurrentActor() actor: Actor, @Body() dto: CreateDelegationDto) {
    return this.approvals.createDelegation(actor, dto);
  }

  @Delete('delegations/:id') @HttpCode(204) @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'removeDelegation' })
  removeDelegation(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.approvals.removeDelegation(actor, id);
  }

  // -- políticas (administração) ----------------------------------------------------------------
  @Get('approval-policies') @CheckAbility('read', 'Rule')
  @ApiOperation({ operationId: 'listPolicies' }) @ApiOkResponse({ type: [PolicyDto] })
  policies() {
    return this.approvals.listPolicies();
  }

  @Post('approval-policies') @CheckAbility('create', 'Rule')
  @ApiOperation({ operationId: 'createPolicy' }) @ApiCreatedResponse({ type: PolicyDto })
  createPolicy(@CurrentActor() actor: Actor, @Body() dto: CreatePolicyDto) {
    return this.approvals.createPolicy(actor, dto);
  }

  @Patch('approval-policies/:id') @CheckAbility('update', 'Rule')
  @ApiOperation({ operationId: 'updatePolicy' }) @ApiOkResponse({ type: PolicyDto })
  updatePolicy(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePolicyDto) {
    return this.approvals.updatePolicy(actor, id, dto);
  }
}

