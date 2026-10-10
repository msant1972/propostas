import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckAbility } from '../authz/authz.js';
import { ClientDto, ClientPageDto, CreateClientDto, ListClientsQuery, UpdateClientDto } from './clients.dto.js';
import { ClientsService } from './clients.service.js';

@ApiTags('clients')
@ApiBearerAuth()
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @CheckAbility('read', 'Client')
  @ApiOperation({ operationId: 'listClients' })
  @ApiOkResponse({ type: ClientPageDto })
  list(@Query() q: ListClientsQuery) {
    return this.clients.list(q);
  }

  @Get(':id')
  @CheckAbility('read', 'Client')
  @ApiOperation({ operationId: 'getClient' })
  @ApiOkResponse({ type: ClientDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(id);
  }

  @Post()
  @CheckAbility('create', 'Client')
  @ApiOperation({ operationId: 'createClient' })
  @ApiCreatedResponse({ type: ClientDto })
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Patch(':id')
  @CheckAbility('update', 'Client')
  @ApiOperation({ operationId: 'updateClient' })
  @ApiOkResponse({ type: ClientDto })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @CheckAbility('delete', 'Client')
  @ApiOperation({ operationId: 'deleteClient' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.remove(id);
  }
}
