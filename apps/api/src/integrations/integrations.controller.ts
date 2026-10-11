import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../authz/ability.js';
import { CheckAbility, CurrentActor } from '../authz/authz.js';
import { Public } from '../auth/public.decorator.js';
import { ApiKeyGuard, ApiKeyScope, type KeyedRequest } from './api-key.guard.js';
import { ApiKeyCreatedDto, ApiKeyDto, CreateApiKeyDto, CrmProposalsPageDto, CrmProposalsQuery, CrmSyncDto, CrmSyncResultDto } from './integrations.dto.js';
import { IntegrationsService } from './integrations.service.js';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller()
export class ApiKeysController {
  constructor(private readonly svc: IntegrationsService) {}

  @Get('api-keys') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'listApiKeys' }) @ApiOkResponse({ type: [ApiKeyDto] })
  list() {
    return this.svc.listKeys();
  }

  @Post('api-keys') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'createApiKey', summary: 'Cria uma chave de API; a chave só é mostrada uma vez' }) @ApiCreatedResponse({ type: ApiKeyCreatedDto })
  create(@CurrentActor() a: Actor, @Body() dto: CreateApiKeyDto) {
    return this.svc.createKey(a, dto);
  }

  @Delete('api-keys/:id') @HttpCode(204) @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'revokeApiKey' })
  revoke(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeKey(a, id);
  }
}

/** Interface para o CRM: autentica com `X-Api-Key`. */
@ApiTags('integrations')
@ApiHeader({ name: 'X-Api-Key', required: true })
@Public()
@UseGuards(ApiKeyGuard)
@Controller('integrations/crm')
export class CrmController {
  constructor(private readonly svc: IntegrationsService) {}

  @Post('clients') @ApiKeyScope('clients:write')
  @ApiOperation({ operationId: 'crmSyncClients', summary: 'O CRM envia clientes (cria/atualiza por externalId)' }) @ApiCreatedResponse({ type: CrmSyncResultDto })
  sync(@Req() req: KeyedRequest, @Body() dto: CrmSyncDto) {
    return this.svc.syncClients(req.apiKey!.id, dto.clients);
  }

  @Get('proposals') @ApiKeyScope('proposals:read')
  @ApiOperation({ operationId: 'crmProposals', summary: 'O CRM lê as propostas alteradas desde um instante' }) @ApiOkResponse({ type: CrmProposalsPageDto })
  proposals(@Query() q: CrmProposalsQuery) {
    return this.svc.proposalsFeed(q.since, q.pageSize);
  }
}
