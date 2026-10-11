import { Inject, Injectable } from '@nestjs/common';
import { isRole, type Role } from '@cpq/shared/roles';
import type { Actor } from '../authz/ability.js';
import type { Principal } from '../auth/principal.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
  teamId: string | null;
  region: string | null;
  mustChangePassword: boolean;
  actor: Actor;
}

const TTL_MS = 15_000;

/** Carrega o utilizador de cada pedido (com uma cache curta) e confirma que a sessão continua válida. */
@Injectable()
export class UsersService {
  private readonly cache = new Map<string, { at: number; user: SessionUser | null; version: number }>();

  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  invalidate(userId: string): void {
    this.cache.delete(userId);
  }

  /** Sessão do utilizador, ou null se foi desativado ou a sessão foi revogada (palavra-passe, papéis ou estado alterados). */
  async session(p: Principal): Promise<SessionUser | null> {
    let entry = this.cache.get(p.userId);
    if (!entry || Date.now() - entry.at >= TTL_MS) {
      const u = await this.prisma.user.findUnique({ where: { id: p.userId } });
      const roles = ((u?.rolesJson as unknown[] | null) ?? []).filter(isRole);
      entry = {
        at: Date.now(),
        // guarda-se o estado atual do utilizador na base de dados, seja qual for o token que o pediu
        version: u?.tokenVersion ?? -1,
        user:
          u && u.isActive
            ? { id: u.id, email: u.email, displayName: u.displayName, roles, teamId: u.teamId, region: u.region, mustChangePassword: u.mustChangePassword, actor: { userId: u.id, teamId: u.teamId, region: u.region, roles } }
            : null,
      };
      this.cache.set(p.userId, entry);
    }
    // cada token só vale se tiver a versão de sessão atual
    return entry.user && entry.version === p.tokenVersion ? entry.user : null;
  }
}
