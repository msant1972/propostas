import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';

const SCOPE = 'apiKeyScope';
/** Rota de integração: autentica com `X-Api-Key` (e não com sessão) e exige o âmbito indicado. */
export const ApiKeyScope = (scope: string) => SetMetadata(SCOPE, scope);

export type KeyedRequest = Request & { apiKey?: { id: string; name: string } };

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: Prisma,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<string | undefined>(SCOPE, [ctx.getHandler(), ctx.getClass()]);
    if (!scope) return true;
    const req = ctx.switchToHttp().getRequest<KeyedRequest>();
    const raw = req.headers['x-api-key'];
    if (typeof raw !== 'string' || raw.length < 20) throw new UnauthorizedException('Chave de API em falta');
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: createHash('sha256').update(raw).digest('hex') } });
    if (!key || key.revokedAt) throw new UnauthorizedException('Chave de API inválida');
    if (!key.scopes.split(',').includes(scope)) throw new ForbiddenException('A chave não tem permissão para esta operação');
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) await this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    req.apiKey = { id: key.id, name: key.name };
    return true;
  }
}
