import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, Body, Put, Delete, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags, ApiAcceptedResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { Actor, AppAbility } from '../authz/ability.js';
import { CheckAbility, CurrentAbility, CurrentActor } from '../authz/authz.js';
import { DocumentsService } from './documents.service.js';
import { ProposalsService } from './proposals.service.js';
import { AddSectionDto, CompileAcceptedDto, DocumentDto, JobStatusDto, ReorderSectionsDto, SectionDto, UpdateSectionDto } from './sections.dto.js';
import { SectionsService } from './sections.service.js';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('proposals/:id')
export class DocumentsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly sections: SectionsService,
    private readonly documents: DocumentsService,
  ) {}

  // -- secções ------------------------------------------------------------------------------------
  @Get('sections') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listSections' }) @ApiOkResponse({ type: [SectionDto] })
  async listSections(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility) {
    await this.proposals.authorized(id, ab, 'read');
    return this.sections.list(id);
  }

  @Post('sections') @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'addSection' }) @ApiCreatedResponse({ type: [SectionDto] })
  async addSection(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility, @Body() dto: AddSectionDto) {
    return this.sections.add(await this.proposals.authorized(id, ab, 'update'), dto);
  }

  @Put('sections/order') @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'reorderSections' }) @ApiOkResponse({ type: [SectionDto] })
  async reorder(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility, @Body() dto: ReorderSectionsDto) {
    return this.sections.reorder(await this.proposals.authorized(id, ab, 'update'), dto.orderedIds);
  }

  @Put('sections/:sectionId') @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'updateSection' }) @ApiOkResponse({ type: [SectionDto] })
  async updateSection(@Param('id', ParseUUIDPipe) id: string, @Param('sectionId', ParseUUIDPipe) sid: string, @CurrentAbility() ab: AppAbility, @Body() dto: UpdateSectionDto) {
    return this.sections.update(await this.proposals.authorized(id, ab, 'update'), sid, dto);
  }

  @Delete('sections/:sectionId') @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'removeSection' }) @ApiOkResponse({ type: [SectionDto] })
  async removeSection(@Param('id', ParseUUIDPipe) id: string, @Param('sectionId', ParseUUIDPipe) sid: string, @CurrentAbility() ab: AppAbility) {
    return this.sections.remove(await this.proposals.authorized(id, ab, 'update'), sid);
  }

  // -- documentos ---------------------------------------------------------------------------------
  @Post('documents/compile') @HttpCode(202) @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'compileDocuments', summary: 'Pede a geração de DOCX e PDF (assíncrona)' }) @ApiAcceptedResponse({ type: CompileAcceptedDto })
  async compile(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility, @CurrentActor() actor: Actor) {
    return this.documents.requestCompile(await this.proposals.authorized(id, ab, 'update'), actor.userId);
  }

  @Get('documents/jobs/:eventId') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'getCompileJob' }) @ApiOkResponse({ type: JobStatusDto })
  async job(@Param('id', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string, @CurrentAbility() ab: AppAbility) {
    await this.proposals.authorized(id, ab, 'read');
    return this.documents.jobStatus(id, eventId);
  }

  @Get('documents') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'listDocuments' }) @ApiOkResponse({ type: [DocumentDto] })
  async list(@Param('id', ParseUUIDPipe) id: string, @CurrentAbility() ab: AppAbility) {
    await this.proposals.authorized(id, ab, 'read');
    return this.documents.list(id);
  }

  @Get('documents/:docId/download') @CheckAbility('read', 'Proposal')
  @ApiOperation({ operationId: 'downloadDocument' })
  async download(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @CurrentAbility() ab: AppAbility, @Res() res: Response) {
    await this.proposals.authorized(id, ab, 'read');
    const f = await this.documents.download(id, docId);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.fileName)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.bytes);
  }

  @Post('documents/upload') @CheckAbility('update', 'Proposal')
  @ApiOperation({ operationId: 'uploadDocument', summary: 'Carrega uma versão editada à mão (corpo binário)' }) @ApiConsumes('application/octet-stream')
  @ApiCreatedResponse({ type: DocumentDto })
  async upload(@Param('id', ParseUUIDPipe) id: string, @Query('kind') kind: string, @Req() req: Request, @CurrentAbility() ab: AppAbility, @CurrentActor() actor: Actor) {
    if (kind !== 'DOCX' && kind !== 'PDF') throw new BadRequestException('kind tem de ser DOCX ou PDF');
    if (!Buffer.isBuffer(req.body)) throw new BadRequestException('Envie o ficheiro como application/octet-stream');
    return this.documents.upload(await this.proposals.authorized(id, ab, 'update'), actor.userId, kind, req.body);
  }
}
