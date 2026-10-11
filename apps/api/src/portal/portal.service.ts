import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { certificateFingerprint, type DocumentRepository } from '@cpq/documents';
import { Prisma as P } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import { DOCUMENT_REPO } from '../proposals/documents.service.js';
import { AuditService } from '../workflow/audit.service.js';
import type { Actor } from '../authz/ability.js';
import type { LinkCreatedDto, LinkDto, PortalResponseDto, PortalViewDto } from './portal.dto.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const NOT_FOUND = 'Ligação inválida ou expirada';

type Link = Awaited<ReturnType<Prisma['shareLink']['findFirstOrThrow']>>;

@Injectable()
export class PortalService {
  private readonly fingerprint: string | null;

  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(ENV) private readonly env: Env,
    @Inject(DOCUMENT_REPO) private readonly repo: DocumentRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {
    this.fingerprint = certificateFingerprint(env.TLS_CERT_FILE);
  }

  // -- lado interno (utilizadores autenticados) --------------------------------------------------

  /** O PDF a enviar é sempre o que está em 02_Enviado, copiado no envio (e que o hash aprovado cobre). */
  private async sentPdf(proposalId: string) {
    const v = await this.prisma.quoteVersion.findFirst({ where: { proposalId, isCurrent: true } });
    const doc = v && (await this.prisma.document.findFirst({ where: { proposalId, quoteVersionId: v.id, kind: 'PDF', folder: 'F02_ENVIADO' }, orderBy: { createdAt: 'desc' } }));
    if (!doc) throw new ConflictException('Não há documento enviado para esta proposta');
    return doc;
  }

  /** Cria uma ligação nova (revoga as anteriores). O token só existe nesta resposta; na base de dados fica o hash. */
  async createLink(p: { id: string; status: string; validUntil: Date | null }, actor: Actor, sendTo?: string): Promise<LinkCreatedDto> {
    if (p.status !== 'SENT') throw new ConflictException('A ligação só se cria depois de a proposta ser enviada');
    const doc = await this.sentPdf(p.id);
    const token = randomBytes(32).toString('base64url');
    const byDays = new Date(Date.now() + this.env.PORTAL_LINK_DAYS * 864e5);
    const byValidity = p.validUntil ? new Date(`${p.validUntil.toISOString().slice(0, 10)}T23:59:59.999Z`) : byDays;
    const expiresAt = byValidity < byDays ? byValidity : byDays;
    if (expiresAt.getTime() <= Date.now()) throw new UnprocessableEntityException('A validade da proposta já terminou');

    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.updateMany({ where: { proposalId: p.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.shareLink.create({ data: { id, proposalId: p.id, documentId: doc.id, tokenHash: sha(token), expiresAt, createdBy: actor.userId } });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'proposal', entityId: p.id, action: 'portal.link_created', diff: { linkId: id, expiresAt: expiresAt.toISOString(), emailed: !!sendTo } });
      // O token vai no evento só até o worker enviar o email; depois o payload é apagado (ver o processador).
      if (sendTo) await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'portal.invite', payload: { linkId: id, to: sendTo, token } });
    });
    return { id, url: `${this.env.PORTAL_BASE_URL.replace(/\/$/, '')}/portal/${token}`, expiresAt: expiresAt.toISOString(), sentTo: sendTo ?? null };
  }

  private status(l: Link, responded: boolean): LinkDto['status'] {
    return responded ? 'RESPONDED' : l.revokedAt ? 'REVOKED' : l.expiresAt.getTime() <= Date.now() ? 'EXPIRED' : 'ACTIVE';
  }

  async listLinks(proposalId: string): Promise<LinkDto[]> {
    const links = await this.prisma.shareLink.findMany({ where: { proposalId }, orderBy: { createdAt: 'desc' } });
    const resp = await this.prisma.customerResponse.findMany({ where: { shareLinkId: { in: links.map((l) => l.id) } } });
    const byLink = new Map(resp.map((r) => [r.shareLinkId, r]));
    return links.map((l) => {
      const r = byLink.get(l.id);
      return {
        id: l.id, status: this.status(l, !!r), createdAt: l.createdAt.toISOString(), expiresAt: l.expiresAt.toISOString(), revokedAt: l.revokedAt?.toISOString() ?? null,
        openCount: l.openCount, firstOpenedAt: l.firstOpenedAt?.toISOString() ?? null, lastOpenedAt: l.lastOpenedAt?.toISOString() ?? null,
        response: r ? { decision: r.decision, signerName: r.signerName, signerEmail: r.signerEmail, decidedAt: r.decidedAt.toISOString() } : null,
      };
    });
  }

  async revoke(proposalId: string, linkId: string, actor: Actor): Promise<void> {
    const l = await this.prisma.shareLink.findFirst({ where: { id: linkId, proposalId } });
    if (!l) throw new NotFoundException('Ligação não encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.update({ where: { id: linkId }, data: { revokedAt: l.revokedAt ?? new Date() } });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'proposal', entityId: proposalId, action: 'portal.link_revoked', diff: { linkId } });
    });
  }

  // -- lado público (o cliente, sem conta) -------------------------------------------------------

  /** Resolve o token; qualquer falha (inexistente, revogada, expirada) dá a mesma resposta, para não revelar nada. */
  private async resolve(token: string): Promise<Link> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException(NOT_FOUND);
    const l = await this.prisma.shareLink.findUnique({ where: { tokenHash: sha(token) } });
    if (!l || l.revokedAt || l.expiresAt.getTime() <= Date.now()) throw new NotFoundException(NOT_FOUND);
    return l;
  }

  async view(token: string, ip: string | undefined, userAgent: string | undefined): Promise<PortalViewDto> {
    const l = await this.resolve(token);
    const [p, doc, resp] = await Promise.all([
      this.prisma.proposal.findUniqueOrThrow({ where: { id: l.proposalId } }),
      this.prisma.document.findUniqueOrThrow({ where: { id: l.documentId } }),
      this.prisma.customerResponse.findUnique({ where: { shareLinkId: l.id } }),
    ]);
    const [client, v] = await Promise.all([
      this.prisma.client.findUniqueOrThrow({ where: { id: p.clientId } }),
      this.prisma.quoteVersion.findUniqueOrThrow({ where: { id: doc.quoteVersionId! } }),
    ]);

    // Acompanhamento de abertura (sem píxeis de rastreio): contagem e datas; a auditoria regista a primeira abertura.
    await this.prisma.$transaction(async (tx) => {
      await tx.shareLink.update({ where: { id: l.id }, data: { openCount: { increment: 1 }, lastOpenedAt: new Date(), ...(l.firstOpenedAt ? {} : { firstOpenedAt: new Date() }) } });
      if (!l.firstOpenedAt) {
        await this.audit.record(tx, { actorUserId: null, entityType: 'proposal', entityId: p.id, action: 'portal.opened', diff: { linkId: l.id } });
        await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'portal.opened', payload: { linkId: l.id } });
      }
    });

    const state = resp ? (resp.decision === 'ACCEPTED' ? 'ACCEPTED' : 'DECLINED') : p.status === 'SENT' ? 'OPEN' : 'CLOSED';
    return {
      proposalCode: p.code, proposalTitle: p.title, clientName: client.name, validUntil: p.validUntil?.toISOString().slice(0, 10) ?? null,
      documentName: doc.fileName, documentSha256: doc.sha256, grandTotal: v.grandTotal.toFixed(2), currency: v.currency, state,
      response: resp ? { decision: resp.decision, signerName: resp.signerName, signerEmail: resp.signerEmail, decidedAt: resp.decidedAt.toISOString() } : null,
      certificateFingerprint: this.fingerprint,
    };
  }

  async document(token: string): Promise<{ bytes: Buffer; fileName: string }> {
    const l = await this.resolve(token);
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: l.documentId } });
    const bytes = await this.repo.get(doc.storageKey).catch(() => null);
    // O que se mostra ao cliente tem de ser exatamente o que foi aprovado e enviado.
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== doc.sha256) throw new ConflictException('O documento não está disponível neste momento');
    return { bytes, fileName: doc.fileName };
  }

  async respond(token: string, dto: PortalResponseDto, ip: string | undefined, userAgent: string | undefined): Promise<PortalViewDto> {
    const l = await this.resolve(token);
    if (dto.decision === 'ACCEPTED' && !dto.confirmRead) throw new UnprocessableEntityException('Para aceitar, confirme que leu o documento');
    const p = await this.prisma.proposal.findUniqueOrThrow({ where: { id: l.proposalId } });
    if (p.status !== 'SENT') throw new ConflictException('Esta proposta já não aceita resposta');
    const doc = await this.prisma.document.findUniqueOrThrow({ where: { id: l.documentId } });
    const bytes = await this.repo.get(doc.storageKey).catch(() => null);
    if (!bytes || createHash('sha256').update(bytes).digest('hex') !== doc.sha256) throw new ConflictException('O documento não está disponível neste momento');

    const accepted = dto.decision === 'ACCEPTED';
    const responseId = uuidv7();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.customerResponse.create({
          data: {
            id: responseId, shareLinkId: l.id, proposalId: p.id, decision: dto.decision, signerName: dto.signerName.trim(), signerEmail: dto.signerEmail.trim().toLowerCase(),
            comment: dto.comment?.trim() || null, documentSha256: doc.sha256, ipAddress: ip?.slice(0, 45) ?? null, userAgent: userAgent?.slice(0, 500) ?? null,
          },
        });
        const to = accepted ? 'ACCEPTED' : 'REJECTED';
        const upd = await tx.proposal.updateMany({ where: { id: p.id, status: 'SENT' }, data: { status: to, statusReason: accepted ? null : dto.comment?.trim() ?? 'Recusada pelo cliente', rowVersion: { increment: 1 } } });
        if (upd.count === 0) throw new ConflictException('Esta proposta já não aceita resposta');
        await this.audit.record(tx, { actorUserId: null, entityType: 'proposal', entityId: p.id, action: accepted ? 'portal.accepted' : 'portal.declined', diff: { responseId, documentSha256: doc.sha256 } }); // os dados pessoais ficam só em customer_responses (podem ser anonimizados)
        await this.audit.record(tx, { actorUserId: null, entityType: 'proposal', entityId: p.id, action: 'proposal.status_changed', diff: { from: 'SENT', to, event: accepted ? 'CUSTOMER_ACCEPT' : 'CUSTOMER_REJECT', via: 'portal' } });
        await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'portal.receipt', payload: { responseId } });
        await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: accepted ? 'proposal.accepted' : 'proposal.rejected', payload: { reason: dto.comment ?? null, via: 'portal' } });
      });
    } catch (e) {
      if (e instanceof P.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('Esta ligação já tem uma resposta');
      throw e;
    }
    return this.view(token, ip, userAgent);
  }
}
