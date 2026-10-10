import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CurrentPrincipal } from './current-user.decorator.js';
import type { Principal } from './principal.js';

@ApiBearerAuth()
@Controller('me')
export class MeController {
  @Get()
  @ApiOperation({ summary: 'Utilizador autenticado e respetivos papéis' })
  me(@CurrentPrincipal() p: Principal) {
    return { oid: p.oid, email: p.email, displayName: p.displayName, roles: p.roles };
  }
}
