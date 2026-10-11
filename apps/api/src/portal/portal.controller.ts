import { Body, Controller, Get, Headers, Ip, Param, ParseUUIDPipe, Post, Delete, HttpCode, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Actor, AppAbility } from '../authz/ability.js';
import { CheckAbility, CurrentAbility, CurrentActor } from '../authz/authz.js';
import { Public } from '../auth/public.decorator.js';
import { ProposalsService } from '../proposals/proposals.service.js';
import { CreateLinkDto, LinkCreatedDto, LinkDto, PortalResponseDto, PortalViewDto } from './portal.dto.js';
import { PortalService } from './portal.service.js';

const RATE = Number(process.env['PORTAL_RATE_PER_MINUTE'] ?? 30);

/** Rotas do portal do cliente: sem autenticação, protegidas pelo token da ligação e por limites de pedidos por IP. */
@ApiTags('portal')
@Controller('portal')
export class PortalPublicController {
  constructor(private readonly portal: PortalService) {}

  @Public() @Throttle({ default: { limit: RATE, ttl: 60_000 } })
  @Get(':token')
  @ApiOperation({ operationId: 'portalView' }) @ApiOkResponse({ type: PortalViewDto })
  view(@Param('token') token: string, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.portal.view(token, ip, ua);
  }

  @Public() @Throttle({ default: { limit: RATE, ttl: 60_000 } })
  @Get(':token/document')
  @ApiOperation({ operationId: 'portalDocument' })
  async document(@Param('token') token: string, @Res() res: Response) {
    const d = await this.portal.document(token);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(d.fileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    // O PDF aparece dentro da página do portal (mesma origem): permite-se só esse enquadramento.
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.send(d.bytes);
  }

  @Public() @Throttle({ default: { limit: Math.max(5, Math.floor(RATE / 3)), ttl: 60_000 } })
  @Post(':token/response')
  @ApiOperation({ operationId: 'portalRespond', summary: 'O cliente aceita ou recusa a proposta' }) @ApiCreatedResponse({ type: PortalViewDto })
  respond(@Param('token') token: string, @Body() dto: PortalResponseDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.portal.respond(token, dto, ip, ua);
  }
}

@ApiTags('portal')
@ApiBearerAuth()
@Controller('proposals/:id/share-links')
export class ShareLinksController {
  constructor(
    private readonly portal: PortalService,
    private readonly proposals: ProposalsService,
  ) {}

  @Get() @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listShareLinks' }) @ApiOkResponse({ type: [LinkDto] })
  async list(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility) {
    await this.proposals.authorized(id, ab, 'read');
    return this.portal.listLinks(id);
  }

  @Post() @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'createShareLink', summary: 'Cria uma ligação do portal (revoga as anteriores); opcionalmente envia por email' }) @ApiCreatedResponse({ type: LinkCreatedDto })
  async create(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility, @CurrentActor() actor: Actor, @Body() dto: CreateLinkDto) {
    return this.portal.createLink(await this.proposals.authorized(id, ab, 'update'), actor, dto.sendTo);
  }

  @Delete(':linkId') @HttpCode(204) @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'revokeShareLink' })
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Param('linkId', ParseUUIDPipe) linkId: string, @CurrentAbility() ab: AppAbility, @CurrentActor() actor: Actor) {
    await this.proposals.authorized(id, ab, 'update');
    return this.portal.revoke(id, linkId, actor);
  }
}
