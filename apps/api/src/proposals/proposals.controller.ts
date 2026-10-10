import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor, AppAbility } from '../authz/ability.js';
import { CheckAbility, CurrentAbility, CurrentActor } from '../authz/authz.js';
import { maskCost } from './mask-cost.js';
import {
  CreateProposalDto, ListProposalsQuery, ProposalDto, ProposalPageDto, QuotePreviewResultDto, QuoteVersionDto,
  QuoteVersionSummaryDto, SaveQuoteDto, UpdateProposalDto, VerifyQuoteDto,
} from './proposals.dto.js';
import { ProposalsService } from './proposals.service.js';
import { QuotesService } from './quotes.service.js';

@ApiTags('proposals')
@ApiBearerAuth()
@Controller('proposals')
export class ProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly quotes: QuotesService,
  ) {}

  @Get()
  @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listProposals' })
  @ApiOkResponse({ type: ProposalPageDto })
  list(@CurrentActor() actor: Actor, @Query() q: ListProposalsQuery) {
    return this.proposals.list(actor, q);
  }

  @Post()
  @CheckAbility('create', 'Proposal')
  @ApiOperation({ operationId: 'createProposal' })
  @ApiCreatedResponse({ type: ProposalDto })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateProposalDto) {
    return this.proposals.create(actor, dto);
  }

  @Get(':id')
  @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'getProposal' })
  @ApiOkResponse({ type: ProposalDto })
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ability: AppAbility) {
    return this.proposals.get(id, ability);
  }

  @Patch(':id')
  @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'updateProposal' })
  @ApiOkResponse({ type: ProposalDto })
  update(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ability: AppAbility, @Body() dto: UpdateProposalDto) {
    return this.proposals.update(id, ability, dto);
  }

  // -- cotações ----------------------------------------------------------------------------------

  @Get(':id/quotes')
  @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listQuoteVersions' })
  @ApiOkResponse({ type: [QuoteVersionSummaryDto] })
  async listQuotes(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ability: AppAbility) {
    await this.proposals.authorized(id, ability, 'read');
    return maskCost(await this.quotes.list(id), ability);
  }

  @Get(':id/quotes/current')
  @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'getCurrentQuote' })
  @ApiOkResponse({ type: QuoteVersionDto })
  async currentQuote(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ability: AppAbility) {
    await this.proposals.authorized(id, ability, 'read');
    return maskCost(await this.quotes.current(id), ability);
  }

  @Post(':id/quotes/preview')
  @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'previewQuote', summary: 'Calcula sem gravar (a UI usa o mesmo motor localmente)' })
  @ApiOkResponse({ type: QuotePreviewResultDto })
  async preview(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ability: AppAbility, @Body() dto: SaveQuoteDto) {
    return maskCost(await this.quotes.preview(await this.proposals.authorized(id, ability, 'read'), dto), ability);
  }

  @Post(':id/quotes/new-version')
  @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'createQuoteVersion' })
  @ApiCreatedResponse({ type: QuoteVersionDto })
  async newVersion(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ability: AppAbility, @CurrentActor() actor: Actor) {
    return maskCost(await this.quotes.newVersion(await this.proposals.authorized(id, ability, 'update'), actor.userId), ability);
  }

  @Get(':id/quotes/:versionId')
  @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'getQuoteVersion' })
  @ApiOkResponse({ type: QuoteVersionDto })
  async getQuote(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @CurrentAbility() ability: AppAbility) {
    await this.proposals.authorized(id, ability, 'read');
    return maskCost(await this.quotes.get(id, versionId), ability);
  }

  @Put(':id/quotes/:versionId')
  @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'saveQuoteDraft', summary: 'Grava o rascunho; o servidor reavalia e rejeita cotações inválidas' })
  @ApiOkResponse({ type: QuoteVersionDto })
  async saveQuote(
    @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentAbility() ability: AppAbility, @Body() dto: SaveQuoteDto,
  ) {
    return maskCost(await this.quotes.saveDraft(await this.proposals.authorized(id, ability, 'update'), versionId, dto), ability);
  }

  @Post(':id/quotes/:versionId/lock')
  @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'lockQuote', summary: 'Bloqueia a versão e calcula o snapshot_hash' })
  @ApiCreatedResponse({ type: QuoteVersionDto })
  async lock(
    @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentAbility() ability: AppAbility, @CurrentActor() actor: Actor,
  ) {
    return maskCost(await this.quotes.lock(await this.proposals.authorized(id, ability, 'update'), versionId, actor.userId), ability);
  }

  @Get(':id/quotes/:versionId/verify')
  @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'verifyQuote', summary: 'Recalcula o hash a partir do snapshot guardado' })
  @ApiOkResponse({ type: VerifyQuoteDto })
  async verify(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string, @CurrentAbility() ability: AppAbility) {
    await this.proposals.authorized(id, ability, 'read');
    return this.quotes.verify(id, versionId);
  }
}
