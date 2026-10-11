import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DUMMY_HASH_PROMISE, hashPassword, validatePassword, verifyPassword } from '@cpq/shared';
import { isRole } from '@cpq/shared/roles';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import { UsersService } from '../users/users.service.js';
import { AuditService } from '../workflow/audit.service.js';
import type { LoginResultDto } from './auth.dto.js';
import { TokenService } from './token.service.js';

const NIL = '00000000-0000-4000-8000-000000000000';
// A auditoria é imutável: não guarda emails digitados por desconhecidos, só uma impressão (permite correlacionar tentativas).
const emailFingerprint = (e: string) => createHash('sha256').update(e).digest('hex').slice(0, 16);

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  private async result(u: { id: string; email: string; displayName: string; rolesJson: unknown; teamId: string | null; mustChangePassword: boolean; tokenVersion: number }): Promise<LoginResultDto> {
    const { token, expiresAt } = await this.tokens.issue({ userId: u.id, tokenVersion: u.tokenVersion });
    return {
      accessToken: token, expiresAt: expiresAt.toISOString(),
      user: { id: u.id, email: u.email, displayName: u.displayName, roles: ((u.rolesJson as unknown[] | null) ?? []).filter(isRole), teamId: u.teamId, mustChangePassword: u.mustChangePassword },
    };
  }

  async login(emailRaw: string, password: string, ip: string | undefined, userAgent: string | undefined): Promise<LoginResultDto> {
    const email = emailRaw.trim().toLowerCase();
    const u = await this.prisma.user.findUnique({ where: { email } });

    // Gasta sempre o mesmo tempo, exista ou não o utilizador, para não revelar quais os emails registados.
    const okPassword = await verifyPassword(password, u?.passwordHash ?? (await DUMMY_HASH_PROMISE));
    const fail = async (reason: string, userId: string | null) => {
      await this.prisma.$transaction((tx) => this.audit.record(tx, { actorUserId: userId, entityType: 'user', entityId: userId ?? NIL, action: 'auth.login_failed', diff: { emailFingerprint: emailFingerprint(email), reason, ip: ip ?? null } }));
    };

    if (!u || !u.isActive || !u.passwordHash) {
      await fail(u ? 'inativo' : 'desconhecido', u?.id ?? null);
      throw new UnauthorizedException('Email ou palavra-passe incorretos');
    }
    if (u.lockedUntil && u.lockedUntil.getTime() > Date.now()) {
      throw new HttpException({ message: 'Conta temporariamente bloqueada por tentativas falhadas. Tente mais tarde.', code: 'ACCOUNT_LOCKED' }, HttpStatus.LOCKED);
    }

    if (!okPassword) {
      const failed = u.failedLogins + 1;
      const lock = failed >= this.env.LOGIN_MAX_ATTEMPTS;
      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: u.id }, data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + this.env.LOGIN_LOCK_MINUTES * 60_000) : null } });
        await this.audit.record(tx, { actorUserId: u.id, entityType: 'user', entityId: u.id, action: lock ? 'auth.locked' : 'auth.login_failed', diff: { ip: ip ?? null, attempts: failed } });
      });
      throw new UnauthorizedException('Email ou palavra-passe incorretos');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), lastSeenAt: new Date() } });
      await this.audit.record(tx, { actorUserId: u.id, entityType: 'user', entityId: u.id, action: 'auth.login', diff: { ip: ip ?? null, userAgent: userAgent?.slice(0, 200) ?? null } });
    });
    return this.result(u);
  }

  /** Muda a palavra-passe: termina todas as outras sessões (nova versão de sessão) e devolve um token novo. */
  async changePassword(userId: string, current: string, next: string): Promise<LoginResultDto> {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(current, u.passwordHash))) throw new UnprocessableEntityException({ message: 'A palavra-passe atual não está correta', code: 'WRONG_PASSWORD' });
    if (current === next) throw new UnprocessableEntityException('A nova palavra-passe tem de ser diferente da atual');
    const problem = validatePassword(next, u.email);
    if (problem) throw new UnprocessableEntityException({ message: problem, code: 'WEAK_PASSWORD' });

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date(), tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null },
      });
      await this.audit.record(tx, { actorUserId: userId, entityType: 'user', entityId: userId, action: 'auth.password_changed' });
      return row;
    });
    this.users.invalidate(userId);
    return this.result(updated);
  }
}
