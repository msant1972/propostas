import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sanitizeHtml, unknownTags } from '@cpq/documents/content';
import { uuidv7 } from '@cpq/shared';
import type { Actor } from '../authz/ability.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type { BlockDto, BlockPageDto, CreateBlockDto, CreateBlockVersionDto, ListBlocksQuery, UpdateBlockDto } from './content.dto.js';

const day = (d: Date) => d.toISOString().slice(0, 10);
const canManageLegal = (a: Actor) => a.roles.includes('Juridico') || a.roles.includes('Administrador');
const isManager = (a: Actor) => ['Gestor_Comercial', 'Juridico', 'Administrador'].some((r) => a.roles.includes(r as never));

type BlockRow = Awaited<ReturnType<Prisma['contentBlock']['findFirstOrThrow']>> & {
  versions: Awaited<ReturnType<Prisma['contentBlockVersion']['findMany']>>;
  tags: Array<{ tag: { name: string } }>;
};

@Injectable()
export class ContentService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  /** Sanitiza o HTML e recusa etiquetas fora do catálogo fechado. */
  private cleanBody(html: string): string {
    const clean = sanitizeHtml(html);
    const bad = unknownTags(clean);
    if (bad.length) throw new UnprocessableEntityException(`Etiquetas desconhecidas: ${bad.map((t) => `{{${t}}}`).join(', ')}`);
    if (!clean.trim()) throw new UnprocessableEntityException('O conteúdo está vazio');
    return clean;
  }

  private dto(b: BlockRow, actor: Actor): BlockDto {
    const today = day(new Date());
    // Quem não gere conteúdos só vê versões aprovadas.
    const versions = b.versions
      .filter((v) => isManager(actor) || v.status === 'APPROVED')
      .sort((x, y) => x.language.localeCompare(y.language) || y.versionNumber - x.versionNumber)
      .map((v) => ({ id: v.id, language: v.language, versionNumber: v.versionNumber, status: v.status, bodyHtml: v.bodyHtml, reviewDueDate: day(v.reviewDueDate), reviewOverdue: day(v.reviewDueDate) < today }));
    return { id: b.id, code: b.code, title: b.title, isLegal: b.isLegal, tags: b.tags.map((t) => t.tag.name).sort(), versions };
  }

  private include = { versions: true, tags: { include: { tag: true } } } as const;

  private async setTags(tx: Pick<Prisma, 'tag' | 'contentBlockTag'>, blockId: string, names: string[]) {
    const clean = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
    await tx.contentBlockTag.deleteMany({ where: { blockId } });
    for (const name of clean) {
      const tag = (await tx.tag.findUnique({ where: { name } })) ?? (await tx.tag.create({ data: { id: uuidv7(), name } }));
      await tx.contentBlockTag.create({ data: { blockId, tagId: tag.id } });
    }
  }

  async list(actor: Actor, q: ListBlocksQuery): Promise<BlockPageDto> {
    const where = {
      deletedAt: null,
      ...(q.q ? { OR: [{ title: { contains: q.q } }, { code: { contains: q.q } }] } : {}),
      ...(q.tag ? { tags: { some: { tag: { name: q.tag.toLowerCase() } } } } : {}),
      ...(q.language ? { versions: { some: { language: q.language } } } : {}),
      ...(isManager(actor) ? {} : { versions: { some: { status: 'APPROVED' as const, ...(q.language ? { language: q.language } : {}) } } }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.contentBlock.findMany({ where, include: this.include, orderBy: { code: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.contentBlock.count({ where }),
    ]);
    return { items: rows.map((r) => this.dto(r as BlockRow, actor)), total, page: q.page, pageSize: q.pageSize };
  }

  async get(actor: Actor, id: string): Promise<BlockDto> {
    const b = await this.prisma.contentBlock.findFirst({ where: { id, deletedAt: null }, include: this.include });
    if (!b) throw new NotFoundException('Bloco não encontrado');
    return this.dto(b as BlockRow, actor);
  }

  async create(actor: Actor, dto: CreateBlockDto): Promise<BlockDto> {
    if (dto.isLegal && !canManageLegal(actor)) throw new ForbiddenException('Só o Jurídico cria blocos jurídicos');
    if (await this.prisma.contentBlock.findUnique({ where: { code: dto.code } })) throw new ConflictException('Já existe um bloco com esse código');
    const body = this.cleanBody(dto.bodyHtml);
    const id = await this.prisma.$transaction(async (tx) => {
      const blockId = uuidv7();
      await tx.contentBlock.create({ data: { id: blockId, code: dto.code, title: dto.title, isLegal: dto.isLegal ?? false, ownerUserId: actor.userId } });
      await tx.contentBlockVersion.create({
        data: { id: uuidv7(), blockId, language: dto.language, versionNumber: 1, bodyHtml: body, reviewDueDate: new Date(dto.reviewDueDate), createdBy: actor.userId },
      });
      await this.setTags(tx, blockId, dto.tags ?? []);
      return blockId;
    });
    return this.get(actor, id);
  }

  async update(actor: Actor, id: string, dto: UpdateBlockDto): Promise<BlockDto> {
    const b = await this.prisma.contentBlock.findFirst({ where: { id, deletedAt: null } });
    if (!b) throw new NotFoundException('Bloco não encontrado');
    if (b.isLegal && !canManageLegal(actor)) throw new ForbiddenException('Só o Jurídico altera blocos jurídicos');
    await this.prisma.$transaction(async (tx) => {
      if (dto.title) await tx.contentBlock.update({ where: { id }, data: { title: dto.title } });
      if (dto.tags) await this.setTags(tx, id, dto.tags);
    });
    return this.get(actor, id);
  }

  async createVersion(actor: Actor, blockId: string, dto: CreateBlockVersionDto): Promise<BlockDto> {
    const b = await this.prisma.contentBlock.findFirst({ where: { id: blockId, deletedAt: null } });
    if (!b) throw new NotFoundException('Bloco não encontrado');
    if (b.isLegal && !canManageLegal(actor)) throw new ForbiddenException('Só o Jurídico altera blocos jurídicos');
    const body = this.cleanBody(dto.bodyHtml);
    const last = await this.prisma.contentBlockVersion.findFirst({ where: { blockId, language: dto.language }, orderBy: { versionNumber: 'desc' } });
    await this.prisma.contentBlockVersion.create({
      data: { id: uuidv7(), blockId, language: dto.language, versionNumber: (last?.versionNumber ?? 0) + 1, bodyHtml: body, reviewDueDate: new Date(dto.reviewDueDate), createdBy: actor.userId },
    });
    return this.get(actor, blockId);
  }

  /** Aprova uma versão: a anterior aprovada da mesma língua passa a RETIRED. Blocos jurídicos: só o Jurídico. */
  async setStatus(actor: Actor, blockId: string, versionId: string, status: 'APPROVED' | 'RETIRED'): Promise<BlockDto> {
    const v = await this.prisma.contentBlockVersion.findFirst({ where: { id: versionId, blockId }, include: { block: true } });
    if (!v) throw new NotFoundException('Versão não encontrada');
    if (v.block.isLegal && !canManageLegal(actor)) throw new ForbiddenException('Só o Jurídico aprova blocos jurídicos');
    if (!isManager(actor)) throw new ForbiddenException('Sem permissão para aprovar conteúdos');
    if (status === 'APPROVED' && v.createdBy === actor.userId && !actor.roles.includes('Administrador')) {
      throw new ForbiddenException('Quem criou a versão não a pode aprovar');
    }
    await this.prisma.$transaction(async (tx) => {
      if (status === 'APPROVED') {
        await tx.contentBlockVersion.updateMany({ where: { blockId, language: v.language, status: 'APPROVED', NOT: { id: versionId } }, data: { status: 'RETIRED' } });
      }
      await tx.contentBlockVersion.update({ where: { id: versionId }, data: { status } });
    });
    return this.get(actor, blockId);
  }
}
