import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MERGE_TAGS } from '@cpq/documents/content';
import type { Actor } from '../authz/ability.js';
import { CheckAbility, CurrentActor } from '../authz/authz.js';
import { BlockDto, BlockPageDto, CreateBlockDto, CreateBlockVersionDto, ListBlocksQuery, MergeTagDto, UpdateBlockDto } from './content.dto.js';
import { ContentService } from './content.service.js';

@ApiTags('content')
@ApiBearerAuth()
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('merge-tags')
  @CheckAbility('read', 'ContentBlock')
  @ApiOperation({ operationId: 'listMergeTags', summary: 'Catálogo fechado de variáveis dos documentos' })
  @ApiOkResponse({ type: [MergeTagDto] })
  tags() {
    return [...Object.entries(MERGE_TAGS).map(([tag, d]) => ({ tag: `{{${tag}}}`, description: d.description })), { tag: '{{tabela_precos}}', description: 'Tabela de preços da cotação (sozinha num parágrafo)' }];
  }

  @Get('blocks') @CheckAbility('read', 'ContentBlock')
  @ApiOperation({ operationId: 'listBlocks' }) @ApiOkResponse({ type: BlockPageDto })
  list(@CurrentActor() a: Actor, @Query() q: ListBlocksQuery) {
    return this.content.list(a, q);
  }

  @Get('blocks/:id') @CheckAbility('read', 'ContentBlock')
  @ApiOperation({ operationId: 'getBlock' }) @ApiOkResponse({ type: BlockDto })
  get(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.content.get(a, id);
  }

  @Post('blocks') @CheckAbility('create', 'ContentBlock')
  @ApiOperation({ operationId: 'createBlock' }) @ApiCreatedResponse({ type: BlockDto })
  create(@CurrentActor() a: Actor, @Body() dto: CreateBlockDto) {
    return this.content.create(a, dto);
  }

  @Patch('blocks/:id') @CheckAbility('update', 'ContentBlock')
  @ApiOperation({ operationId: 'updateBlock' }) @ApiOkResponse({ type: BlockDto })
  update(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBlockDto) {
    return this.content.update(a, id, dto);
  }

  @Post('blocks/:id/versions') @CheckAbility('update', 'ContentBlock')
  @ApiOperation({ operationId: 'createBlockVersion' }) @ApiCreatedResponse({ type: BlockDto })
  version(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateBlockVersionDto) {
    return this.content.createVersion(a, id, dto);
  }

  @Post('blocks/:id/versions/:versionId/approve') @CheckAbility('update', 'ContentBlock')
  @ApiOperation({ operationId: 'approveBlockVersion' }) @ApiCreatedResponse({ type: BlockDto })
  approve(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) vid: string) {
    return this.content.setStatus(a, id, vid, 'APPROVED');
  }

  @Post('blocks/:id/versions/:versionId/retire') @CheckAbility('update', 'ContentBlock')
  @ApiOperation({ operationId: 'retireBlockVersion' }) @ApiCreatedResponse({ type: BlockDto })
  retire(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) vid: string) {
    return this.content.setStatus(a, id, vid, 'RETIRED');
  }
}
