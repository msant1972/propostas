import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Actor, AppAbility } from '../authz/ability.js';
import { UsersService, type SessionUser } from '../users/users.service.js';
import { ALLOW_PASSWORD_CHANGE, IS_PUBLIC } from './public.decorator.js';
import type { Principal } from './principal.js';
import { InvalidTokenError, TokenService } from './token.service.js';

export type AuthedRequest = Request & { principal?: Principal; user?: SessionUser; actor?: Actor; ability?: AppAbility };

/** Valida o token, carrega o utilizador (ativo, mesma versão de sessão) e exige a mudança de palavra-passe pendente. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Token em falta');

    try {
      req.principal = await this.tokens.verify(token);
    } catch (e) {
      if (e instanceof InvalidTokenError) throw new UnauthorizedException(e.message);
      throw e;
    }
    const session = await this.users.session(req.principal);
    if (!session) throw new UnauthorizedException('Sessão terminada: inicie sessão de novo');
    req.user = session;
    req.actor = session.actor;

    if (session.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE, targets)) {
      throw new ForbiddenException({ message: 'Tem de mudar a palavra-passe antes de continuar', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    return true;
  }
}
