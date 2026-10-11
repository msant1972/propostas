import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../authz/ability.js';
import { CheckAbility, CurrentActor } from '../authz/authz.js';
import { CreateTeamDto, CreateUserDto, ListUsersQuery, TeamDto, UpdateUserDto, UserDto, UserPageDto, UserWithPasswordDto } from './users-admin.dto.js';
import { UsersAdminService } from './users-admin.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller()
export class UsersAdminController {
  constructor(private readonly admin: UsersAdminService) {}

  @Get('users') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'listUsers' }) @ApiOkResponse({ type: UserPageDto })
  list(@Query() q: ListUsersQuery) {
    return this.admin.list(q);
  }

  @Post('users') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'createUser', summary: 'Cria um utilizador com palavra-passe temporária' }) @ApiCreatedResponse({ type: UserWithPasswordDto })
  create(@CurrentActor() a: Actor, @Body() dto: CreateUserDto) {
    return this.admin.create(a, dto);
  }

  @Patch('users/:id') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'updateUser' }) @ApiOkResponse({ type: UserDto })
  update(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.admin.update(a, id, dto);
  }

  @Post('users/:id/reset-password') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'resetUserPassword' }) @ApiCreatedResponse({ type: UserWithPasswordDto })
  reset(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.resetPassword(a, id);
  }

  @Post('users/:id/unlock') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'unlockUser' }) @ApiCreatedResponse({ type: UserDto })
  unlock(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.unlock(a, id);
  }

  @Get('teams') @CheckAbility('read', 'Client')
  @ApiOperation({ operationId: 'listTeams' }) @ApiOkResponse({ type: [TeamDto] })
  teams() {
    return this.admin.teams();
  }

  @Post('teams') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'createTeam' }) @ApiCreatedResponse({ type: TeamDto })
  createTeam(@CurrentActor() a: Actor, @Body() dto: CreateTeamDto) {
    return this.admin.createTeam(a, dto);
  }
}
