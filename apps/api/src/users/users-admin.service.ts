import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { hashPassword, temporaryPassword, uuidv7, validatePassword } from '@cpq/shared';
import { isRole } from '@cpq/shared/roles';
import type { Actor } from '../authz/ability.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import { AuditService } from '../workflow/audit.service.js';
import type { CreateTeamDto, CreateUserDto, ListUsersQuery, TeamDto, UpdateUserDto, UserDto, UserPageDto, UserWithPasswordDto } from './users-admin.dto.js';
import { UsersService } from './users.service.js';

type Row = Awaited<ReturnType<Prisma['user']['findFirstOrThrow']>> & { team?: { name: string } | null };

@Injectable()
export class UsersAdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly sessions: UsersService,
    private readonly audit: AuditService,
  ) {}

  private dto(u: Row): UserDto {
    return {
      id: u.id, email: u.email, displayName: u.displayName, roles: ((u.rolesJson as unknown[] | null) ?? []).filter(isRole), teamId: u.teamId,
      teamName: u.team?.name ?? null, region: u.region, isActive: u.isActive, mustChangePassword: u.mustChangePassword,
      locked: !!u.lockedUntil && u.lockedUntil.getTime() > Date.now(), lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    };
  }

  async list(q: ListUsersQuery): Promise<UserPageDto> {
    const where = q.q ? { OR: [{ email: { contains: q.q } }, { displayName: { contains: q.q } }] } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, include: { team: true }, orderBy: { displayName: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return { items: rows.map((r) => this.dto(r)), total, page: q.page, pageSize: q.pageSize };
  }

  private async assertTeam(teamId?: string | null) {
    if (teamId && !(await this.prisma.team.count({ where: { id: teamId } }))) throw new UnprocessableEntityException('Equipa inexistente');
  }

  async create(actor: Actor, dto: CreateUserDto): Promise<UserWithPasswordDto> {
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException('Já existe um utilizador com esse email');
    await this.assertTeam(dto.teamId);
    const temp = dto.password ? null : temporaryPassword();
    const password = dto.password ?? temp!;
    const problem = validatePassword(password, email);
    if (problem) throw new UnprocessableEntityException({ message: problem, code: 'WEAK_PASSWORD' });

    const user = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.create({
        data: { id: uuidv7(), email, displayName: dto.displayName, rolesJson: [...new Set(dto.roles)], teamId: dto.teamId, region: dto.region, passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() },
        include: { team: true },
      });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'user', entityId: row.id, action: 'user.created', diff: { email, roles: dto.roles, teamId: dto.teamId ?? null } });
      return row;
    });
    return { user: this.dto(user), temporaryPassword: temp };
  }

  /** O sistema nunca fica sem administradores ativos. */
  private async assertNotLastAdmin(userId: string) {
    const admins = await this.prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM users WHERE is_active = TRUE AND JSON_CONTAINS(roles_json, JSON_QUOTE('Administrador')) AND id <> ${userId}`;
    if (admins.length === 0) throw new ConflictException({ message: 'Tem de existir pelo menos um administrador ativo', code: 'LAST_ADMIN' });
  }

  async update(actor: Actor, id: string, dto: UpdateUserDto): Promise<UserDto> {
    const cur = await this.prisma.user.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Utilizador não encontrado');
    await this.assertTeam(dto.teamId);

    const wasAdmin = ((cur.rolesJson as unknown[] | null) ?? []).includes('Administrador') && cur.isActive;
    const willBeAdmin = (dto.roles ?? ((cur.rolesJson as string[] | null) ?? [])).includes('Administrador') && (dto.isActive ?? cur.isActive);
    if (wasAdmin && !willBeAdmin) await this.assertNotLastAdmin(id);

    const sessionChanged = dto.roles !== undefined || dto.isActive !== undefined || dto.teamId !== undefined;
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.user.update({
        where: { id },
        data: {
          ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}), ...(dto.roles ? { rolesJson: [...new Set(dto.roles)] } : {}),
          ...(dto.teamId !== undefined ? { teamId: dto.teamId } : {}), ...(dto.region !== undefined ? { region: dto.region || null } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}), ...(sessionChanged ? { tokenVersion: { increment: 1 } } : {}),
        },
        include: { team: true },
      });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'user', entityId: id, action: 'user.updated', diff: dto as never });
      return r;
    });
    this.sessions.invalidate(id);
    return this.dto(row);
  }

  /** Nova palavra-passe temporária: termina as sessões, desbloqueia e obriga a mudá-la no próximo acesso. */
  async resetPassword(actor: Actor, id: string): Promise<UserWithPasswordDto> {
    const cur = await this.prisma.user.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Utilizador não encontrado');
    const temp = temporaryPassword();
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.user.update({
        where: { id }, include: { team: true },
        data: { passwordHash: await hashPassword(temp), mustChangePassword: true, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null, tokenVersion: { increment: 1 } },
      });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'user', entityId: id, action: 'user.password_reset' });
      return r;
    });
    this.sessions.invalidate(id);
    return { user: this.dto(row), temporaryPassword: temp };
  }

  async unlock(actor: Actor, id: string): Promise<UserDto> {
    const row = await this.prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null }, include: { team: true } }).catch(() => null);
    if (!row) throw new NotFoundException('Utilizador não encontrado');
    await this.prisma.$transaction((tx) => this.audit.record(tx, { actorUserId: actor.userId, entityType: 'user', entityId: id, action: 'user.unlocked' }));
    return this.dto(row);
  }

  async teams(): Promise<TeamDto[]> {
    return (await this.prisma.team.findMany({ orderBy: { name: 'asc' } })).map((t) => ({ id: t.id, name: t.name }));
  }

  async createTeam(actor: Actor, dto: CreateTeamDto): Promise<TeamDto> {
    if (await this.prisma.team.findUnique({ where: { name: dto.name } })) throw new ConflictException('Já existe uma equipa com esse nome');
    const t = await this.prisma.$transaction(async (tx) => {
      const row = await tx.team.create({ data: { id: uuidv7(), name: dto.name } });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'team', entityId: row.id, action: 'team.created', diff: { name: dto.name } });
      return row;
    });
    return { id: t.id, name: t.name };
  }
}
