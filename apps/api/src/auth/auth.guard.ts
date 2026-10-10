import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC } from './public.decorator.js';
import type { Principal } from './principal.js';
import { InvalidTokenError, type TokenVerifier } from './token-verifier.js';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export type AuthedRequest = Request & { principal?: Principal };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedException('Token em falta');

    try {
      req.principal = await this.verifier.verify(token);
      return true;
    } catch (e) {
      if (e instanceof InvalidTokenError) throw new UnauthorizedException(e.message);
      throw e;
    }
  }
}
