import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { defineAbilityFor, type Action, type Actor, type AppAbility, type Subject } from './ability.js';
import { IS_PUBLIC } from '../auth/public.decorator.js';

export type ActorRequest = AuthedRequest & { actor?: Actor; ability?: AppAbility };

const CHECK = 'checkAbility';
/** Exige que o utilizador possa executar `action` sobre o tipo `subject` (regras por registo aplicam-se na consulta). */
export const CheckAbility = (action: Action, subject: Subject) => SetMetadata(CHECK, [action, subject]);

/** Valida a permissão declarada na rota para o utilizador já carregado pelo AuthGuard. */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<ActorRequest>();
    if (!req.actor) return true; // a rota não passou pelo AuthGuard

    const required = this.reflector.getAllAndOverride<[Action, Subject] | undefined>(CHECK, targets);
    if (!required) return true;

    req.ability ??= defineAbilityFor(req.actor);
    if (!req.ability.can(...required)) throw new ForbiddenException('Sem permissão para esta operação');
    return true;
  }
}

import { createParamDecorator } from '@nestjs/common';

/** Utilizador autenticado (linha de `users` + papéis); só existe em rotas com @CheckAbility. */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest<ActorRequest>().actor!;
});

/** Permissões do utilizador, para verificar regras por registo depois de carregar o objeto. */
export const CurrentAbility = createParamDecorator((_: unknown, ctx: ExecutionContext): AppAbility => {
  return ctx.switchToHttp().getRequest<ActorRequest>().ability!;
});
