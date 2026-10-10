import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { sanitizeHtml, unknownTags } from '@cpq/documents/content';
import { uuidv7 } from '@cpq/shared';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type { AddSectionDto, SectionDto, UpdateSectionDto } from './sections.dto.js';

@Injectable()
export class SectionsService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  private assertEditable(status: string): void {
    if (status !== 'DRAFT') throw new ConflictException('As secções só se alteram com a proposta em rascunho');
  }

  private clean(html: string): string {
    const clean = sanitizeHtml(html);
    const bad = unknownTags(clean);
    if (bad.length) throw new UnprocessableEntityException(`Etiquetas desconhecidas: ${bad.map((t) => `{{${t}}}`).join(', ')}`);
    return clean;
  }

  async list(proposalId: string): Promise<SectionDto[]> {
    const rows = await this.prisma.proposalSection.findMany({ where: { proposalId }, orderBy: { position: 'asc' }, include: { document: true } });
    const versionIds = rows.map((r) => r.blockVersionId).filter((x): x is string => !!x);
    const versions = await this.prisma.contentBlockVersion.findMany({ where: { id: { in: versionIds } }, include: { block: true } });
    const byId = new Map(versions.map((v) => [v.id, v]));
    return rows.map((r) => {
      const v = r.blockVersionId ? byId.get(r.blockVersionId) : undefined;
      return {
        id: r.id, position: r.position, title: r.title, html: r.document?.htmlCache ?? v?.bodyHtml ?? '', isModified: r.isModified,
        isLegal: v?.block.isLegal ?? false, blockVersionId: r.blockVersionId, blockCode: v?.block.code ?? null, rowVersion: r.rowVersion,
      };
    });
  }

  async add(proposal: { id: string; status: string }, dto: AddSectionDto): Promise<SectionDto[]> {
    this.assertEditable(proposal.status);
    let html = '<p></p>';
    let title = dto.title;
    if (dto.blockVersionId) {
      const v = await this.prisma.contentBlockVersion.findUnique({ where: { id: dto.blockVersionId }, include: { block: true } });
      if (!v || v.block.deletedAt) throw new NotFoundException('Versão de bloco não encontrada');
      if (v.status !== 'APPROVED') throw new UnprocessableEntityException('Só se usam versões aprovadas');
      html = v.bodyHtml;
      title ??= v.block.title;
    }
    if (!title) throw new UnprocessableEntityException('Indique o título da secção');

    const last = await this.prisma.proposalSection.findFirst({ where: { proposalId: proposal.id }, orderBy: { position: 'desc' } });
    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.proposalSection.create({ data: { id, proposalId: proposal.id, position: (last?.position ?? 0) + 1, title, blockVersionId: dto.blockVersionId } });
      await tx.sectionDocument.create({ data: { sectionId: id, ydocState: Buffer.alloc(0), htmlCache: html } });
    });
    return this.list(proposal.id);
  }

  async update(proposal: { id: string; status: string }, sectionId: string, dto: UpdateSectionDto): Promise<SectionDto[]> {
    this.assertEditable(proposal.status);
    const s = await this.prisma.proposalSection.findFirst({ where: { id: sectionId, proposalId: proposal.id }, include: { document: true } });
    if (!s) throw new NotFoundException('Secção não encontrada');
    if (s.rowVersion !== dto.rowVersion) throw new ConflictException('A secção foi alterada por outra pessoa; recarregue antes de gravar');

    const html = dto.html !== undefined ? this.clean(dto.html) : undefined;
    let isModified = s.isModified;
    if (html !== undefined && s.blockVersionId) {
      const v = await this.prisma.contentBlockVersion.findUnique({ where: { id: s.blockVersionId } });
      isModified = v ? sanitizeHtml(v.bodyHtml) !== html : true;
    }
    const res = await this.prisma.proposalSection.updateMany({
      where: { id: sectionId, rowVersion: dto.rowVersion },
      data: { ...(dto.title ? { title: dto.title } : {}), isModified, rowVersion: { increment: 1 } },
    });
    if (res.count === 0) throw new ConflictException('A secção foi alterada por outra pessoa; recarregue antes de gravar');
    if (html !== undefined) {
      await this.prisma.sectionDocument.upsert({
        where: { sectionId },
        update: { htmlCache: html },
        create: { sectionId, ydocState: Buffer.alloc(0), htmlCache: html },
      });
    }
    return this.list(proposal.id);
  }

  async remove(proposal: { id: string; status: string }, sectionId: string): Promise<SectionDto[]> {
    this.assertEditable(proposal.status);
    const s = await this.prisma.proposalSection.findFirst({ where: { id: sectionId, proposalId: proposal.id } });
    if (!s) throw new NotFoundException('Secção não encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.proposalSection.delete({ where: { id: sectionId } });
      const rest = await tx.proposalSection.findMany({ where: { proposalId: proposal.id }, orderBy: { position: 'asc' } });
      for (const [i, r] of rest.entries()) await tx.proposalSection.update({ where: { id: r.id }, data: { position: i + 1 } });
    });
    return this.list(proposal.id);
  }

  async reorder(proposal: { id: string; status: string }, orderedIds: string[]): Promise<SectionDto[]> {
    this.assertEditable(proposal.status);
    const current = await this.prisma.proposalSection.findMany({ where: { proposalId: proposal.id } });
    const same = orderedIds.length === current.length && new Set(orderedIds).size === current.length && current.every((c) => orderedIds.includes(c.id));
    if (!same) throw new UnprocessableEntityException('A lista tem de conter exatamente as secções da proposta');
    await this.prisma.$transaction(orderedIds.map((id, i) => this.prisma.proposalSection.update({ where: { id }, data: { position: i + 1 } })));
    return this.list(proposal.id);
  }
}
