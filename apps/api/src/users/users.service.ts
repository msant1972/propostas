import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { uuidv7 } from '@cpq/shared';
import type { Principal } from '../auth/principal.js';
import type { Actor } from '../authz/ability.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TTL_MS = 60_000;

@Injectable()
export class UsersService {
  private readonly cache = new Map<string, { actor: Actor; at: number }>();

  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  /** Cria ou atualiza o utilizador no primeiro pedido e devolve o ator para a autorização. */
  async actorFor(p: Principal): Promise<Actor> {
    if (!UUID.test(p.oid)) throw new UnauthorizedException('Identificador de utilizador inválido');

    const key = `${p.oid}|${p.email}|${p.displayName}|${p.roles.join(',')}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.actor;

    const user = await this.prisma.user.upsert({
      where: { entraOid: p.oid.toLowerCase() },
      update: { email: p.email, displayName: p.displayName },
      create: { id: uuidv7(), entraOid: p.oid.toLowerCase(), email: p.email, displayName: p.displayName },
    });
    if (!user.isActive) throw new UnauthorizedException('Utilizador desativado');

    const actor: Actor = { userId: user.id, teamId: user.teamId, region: user.region, roles: p.roles };
    this.cache.set(key, { actor, at: Date.now() });
    return actor;
  }
}
