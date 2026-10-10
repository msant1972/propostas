import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { subject } from '@casl/ability';
import { Prisma as PrismaNs } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { visibleProposalsWhere, type Action, type Actor, type AppAbility } from '../authz/ability.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type { CreateProposalDto, ListProposalsQuery, ProposalDto, ProposalPageDto, UpdateProposalDto } from './proposals.dto.js';
import { QuotesService } from './quotes.service.js';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

type Row = Awaited<ReturnType<Prisma['proposal']['findFirstOrThrow']>>;

function toDto(p: Row): ProposalDto {
  return {
    id: p.id, code: p.code, title: p.title, clientId: p.clientId, ownerUserId: p.ownerUserId, status: p.status,
    currency: p.currency, language: p.language, validUntil: day(p.validUntil), createdAt: p.createdAt.toISOString(),
    statusReason: p.statusReason, sentAt: p.sentAt?.toISOString() ?? null,
  };
}

@Injectable()
export class ProposalsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly quotes: QuotesService,
  ) {}

  /** Carrega a proposta e aplica a regra por registo (dono, equipa, região) antes de devolvê-la. */
  async authorized(id: string, ability: AppAbility, action: Action): Promise<Row> {
    const p = await this.prisma.proposal.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Proposta não encontrada');
    if (!ability.can(action, subject('Proposal', p as never))) {
      // Para quem não pode sequer ver a proposta, o 404 não revela que ela existe.
      throw ability.can('read', subject('Proposal', p as never)) ? new ForbiddenException('Sem permissão para esta operação') : new NotFoundException('Proposta não encontrada');
    }
    return p;
  }

  async list(actor: Actor, q: ListProposalsQuery): Promise<ProposalPageDto> {
    const where = {
      AND: [
        { deletedAt: null },
        visibleProposalsWhere(actor),
        ...(q.status ? [{ status: q.status as never }] : []),
        ...(q.clientId ? [{ clientId: q.clientId }] : []),
        ...(q.q ? [{ OR: [{ title: { contains: q.q } }, { code: { contains: q.q } }] }] : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.proposal.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.proposal.count({ where }),
    ]);
    return { items: items.map(toDto), total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string, ability: AppAbility): Promise<ProposalDto> {
    return toDto(await this.authorized(id, ability, 'read'));
  }

  async create(actor: Actor, dto: CreateProposalDto): Promise<ProposalDto> {
    const client = await this.prisma.client.findFirst({ where: { id: dto.clientId, deletedAt: null } });
    if (!client) throw new UnprocessableEntityException('Cliente inexistente');

    const year = new Date().getUTCFullYear();
    // O código é sequencial por ano; em corrida, a restrição UNIQUE força nova tentativa.
    for (let attempt = 0; attempt < 5; attempt++) {
      const count = await this.prisma.proposal.count({ where: { code: { startsWith: `P-${year}-` } } });
      const code = `P-${year}-${String(count + 1 + attempt).padStart(4, '0')}`;
      try {
        return await this.prisma.$transaction(async (tx) => {
          const p = await tx.proposal.create({
            data: {
              id: uuidv7(), code, title: dto.title, clientId: client.id, ownerUserId: actor.userId, ownerTeamId: actor.teamId,
              region: actor.region, currency: dto.currency ?? 'EUR', language: dto.language ?? 'pt-PT',
              validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
            },
          });
          await this.quotes.createInitialVersion(tx, p, client, actor.userId);
          return toDto(p);
        });
      } catch (e) {
        if (e instanceof PrismaNs.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new ConflictException('Não foi possível gerar o código da proposta; tente de novo');
  }

  async update(id: string, ability: AppAbility, dto: UpdateProposalDto): Promise<ProposalDto> {
    const p = await this.authorized(id, ability, 'update');
    if (p.status !== 'DRAFT') throw new ConflictException('Só é possível alterar propostas em rascunho');
    const updated = await this.prisma.proposal.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        ...(dto.validUntil !== undefined ? { validUntil: new Date(dto.validUntil) } : {}),
        rowVersion: { increment: 1 },
      },
    });
    return toDto(updated);
  }
}
