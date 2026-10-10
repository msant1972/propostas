import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from '../auth/auth.guard.js';
import { UsersService } from '../users/users.service.js';
import { defineAbilityFor, type Action, type Actor, type AppAbility, type Subject } from './ability.js';
import { IS_PUBLIC } from '../auth/public.decorator.js';

export type ActorRequest = AuthedRequest & { actor?: Actor; ability?: AppAbility };

const CHECK = 'checkAbility';
/** Exige que o utilizador possa executar `action` sobre o tipo `subject` (regras por registo aplicam-se na consulta). */
export const CheckAbility = (action: Action, subject: Subject) => SetMetadata(CHECK, [action, subject]);

/** Liga o principal à linha de `users` e valida a permissão declarada na rota. */
@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<ActorRequest>();
    if (!req.principal) return true; // a rota não passou pelo AuthGuard

    const required = this.reflector.getAllAndOverride<[Action, Subject] | undefined>(CHECK, targets);
    if (!required) return true;

    req.actor ??= await this.users.actorFor(req.principal);
    req.ability ??= defineAbilityFor(req.actor);
    if (!req.ability.can(...required)) throw new ForbiddenException('Sem permissão para esta operação');
    return true;
  }
}
