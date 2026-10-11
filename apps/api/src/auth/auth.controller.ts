import { Body, Controller, Get, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { SessionUser } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import { ChangePasswordDto, LoginDto, LoginResultDto, SessionUserDto } from './auth.dto.js';
import { CurrentUser } from './current-user.decorator.js';
import { AllowPasswordChange, Public } from './public.decorator.js';

@ApiTags('auth')
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: Number(process.env['LOGIN_RATE_PER_MINUTE'] ?? 10), ttl: 60_000 } }) // contra tentativas em massa, por IP
  @Post('auth/login')
  @ApiOperation({ operationId: 'login' })
  @ApiCreatedResponse({ type: LoginResultDto })
  login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') ua?: string) {
    return this.auth.login(dto.email, dto.password, ip, ua);
  }

  @ApiBearerAuth()
  @AllowPasswordChange()
  @Post('auth/change-password')
  @ApiOperation({ operationId: 'changePassword', summary: 'Muda a palavra-passe e devolve um token novo' })
  @ApiCreatedResponse({ type: LoginResultDto })
  change(@CurrentUser() u: SessionUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(u.id, dto.currentPassword, dto.newPassword);
  }

  @ApiBearerAuth()
  @AllowPasswordChange()
  @Post('auth/logout') @HttpCode(204)
  @ApiOperation({ operationId: 'logout', summary: 'Termina a sessão: invalida os tokens emitidos até agora para este utilizador' })
  @ApiNoContentResponse()
  logout(@CurrentUser() u: SessionUser) {
    return this.auth.logout(u.id);
  }

  @ApiBearerAuth()
  @AllowPasswordChange()
  @Get('me')
  @ApiOperation({ operationId: 'getMe', summary: 'Utilizador autenticado e respetivos papéis' })
  @ApiOkResponse({ type: SessionUserDto })
  me(@CurrentUser() u: SessionUser) {
    return { id: u.id, email: u.email, displayName: u.displayName, roles: u.roles, teamId: u.teamId, mustChangePassword: u.mustChangePassword };
  }
}
