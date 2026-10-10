import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { approvalVars, evaluatePolicies, type ApprovalPolicy } from '@cpq/rules-engine';
import { currentQuoteFingerprint, type DocumentRepository } from '@cpq/documents';
import type { Prisma as P } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { availableEvents, InvalidTransitionError, transition, type ProposalStatus, type WorkflowEvent } from '@cpq/shared/workflow';
import type { Actor, AppAbility } from '../authz/ability.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import { DOCUMENT_REPO } from '../proposals/documents.service.js';
import { ProposalsService } from '../proposals/proposals.service.js';
import { QuotesService } from '../proposals/quotes.service.js';
import { AuditService } from './audit.service.js';
import type { TimelineEntryDto, TransitionDto, TransitionResultDto } from './workflow.dto.js';

type Tx = P.TransactionClient;
type ProposalRow = Awaited<ReturnType<ProposalsService['authorized']>>;

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);

export function toPolicy(r: { id: string; name: string; scope: 'COMMERCIAL' | 'LEGAL'; conditionJson: unknown; mode: 'SEQUENTIAL' | 'PARALLEL'; levelsJson: unknown; priority: number; isActive: boolean; validFrom: Date; validTo: Date | null }): ApprovalPolicy {
  const cond = r.conditionJson as Record<string, unknown> | null;
  return {
    id: r.id, name: r.name, scope: r.scope, condition: cond && Object.keys(cond).length ? cond : null, mode: r.mode,
    levels: r.levelsJson as ApprovalPolicy['levels'], priority: r.priority, isActive: r.isActive, validFrom: day(r.validFrom)!, validTo: day(r.validTo),
  };
}

/**
 * Máquina de estados da proposta com os seus efeitos (bloquear cotação, pedir aprovações, verificar hashes,
 * copiar para 02_Enviado…). As transições vêm da tabela partilhada em `@cpq/shared/workflow`.
 */
@Injectable()
export class WorkflowService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(DOCUMENT_REPO) private readonly repo: DocumentRepository,
    private readonly proposals: ProposalsService,
    private readonly quotes: QuotesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  private fail(code: string, message: string, status: 409 | 422 = 409): never {
    const body = { message, code };
    throw status === 409 ? new ConflictException(body) : new UnprocessableEntityException(body);
  }

  async available(proposalId: string, ability: AppAbility): Promise<TransitionResultDto> {
    const p = await this.proposals.authorized(proposalId, ability, 'read');
    const can = ability.can('update', (await import('@casl/ability')).subject('Proposal', p as never));
    return { status: p.status, availableEvents: can ? availableEvents(p.status as ProposalStatus).filter((e) => e !== 'APPROVE' && e !== 'EXPIRE') : [] };
  }

  async transition(proposalId: string, actor: Actor, ability: AppAbility, dto: TransitionDto): Promise<TransitionResultDto> {
    const p = await this.proposals.authorized(proposalId, ability, 'update');
    let t;
    try {
      t = transition(p.status as ProposalStatus, dto.event as WorkflowEvent);
    } catch (e) {
      if (e instanceof InvalidTransitionError) this.fail('INVALID_TRANSITION', `Não é possível ${dto.event} com a proposta em ${p.status}`);
      throw e;
    }
    const needsReason = t.requiresReason || dto.event === 'CUSTOMER_ACCEPT' || dto.event === 'CUSTOMER_REJECT';
    if (needsReason && !dto.reason?.trim()) this.fail('REASON_REQUIRED', 'Indique o motivo', 422);
    if (t.requiresConfirmation && !dto.confirm) this.fail('NEEDS_CONFIRMATION', 'Esta ação invalida as aprovações e cria uma nova versão da cotação. Confirme para continuar.', 422);

    switch (dto.event) {
      case 'COMPILE': await this.compile(p, actor); break;
      case 'SUBMIT': await this.submit(p, actor); break;
      case 'SEND': await this.send(p, actor); break;
      case 'EDIT':
      case 'RETURN':
      case 'REVISE':
      case 'REOPEN': await this.backToDraft(p, actor, dto.event, dto.reason); break;
      case 'CANCEL': await this.setStatus(p, actor, 'CANCELLED', dto.event, dto.reason, { cancelRequests: 'CANCELLED' }); break;
      case 'CUSTOMER_ACCEPT': await this.setStatus(p, actor, 'ACCEPTED', dto.event, dto.reason); break;
      case 'CUSTOMER_REJECT': await this.setStatus(p, actor, 'REJECTED', dto.event, dto.reason); break;
    }
    const after = await this.prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    return { status: after.status, availableEvents: availableEvents(after.status as ProposalStatus).filter((e) => e !== 'APPROVE' && e !== 'EXPIRE') };
  }

  // -- efeitos ---------------------------------------------------------------------------------

  private async currentVersion(proposalId: string) {
    const v = await this.prisma.quoteVersion.findFirst({ where: { proposalId, isCurrent: true } });
    if (!v) this.fail('NO_QUOTE', 'A proposta não tem cotação');
    return v;
  }

  private async latestDocs(db: Pick<Prisma, 'document'>, proposalId: string, quoteVersionId: string) {
    const find = (kind: 'PDF' | 'DOCX') => db.document.findFirst({ where: { proposalId, quoteVersionId, kind, folder: 'F01_TRABALHO' }, orderBy: { createdAt: 'desc' } });
    return { pdf: await find('PDF'), docx: await find('DOCX') };
  }

  private async changeStatus(tx: Tx, p: { id: string }, actor: Actor, from: string, to: ProposalStatus, event: string, reason: string | undefined, extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
    await tx.proposal.update({ where: { id: p.id }, data: { status: to, statusReason: reason ?? null, rowVersion: { increment: 1 }, ...data } as never });
    await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'proposal', entityId: p.id, action: 'proposal.status_changed', diff: { from, to, event, reason: reason ?? null, ...extra } });
  }

  private async compile(p: ProposalRow, actor: Actor) {
    const v = await this.currentVersion(p.id);
    const { pdf, docx } = await this.latestDocs(this.prisma, p.id, v.id);
    if (!pdf || !docx) this.fail('NO_DOCUMENT', 'Gere o documento (DOCX e PDF) antes de submeter para revisão');
    await this.prisma.$transaction((tx) => this.changeStatus(tx, p, actor, p.status, 'IN_REVIEW', 'COMPILE', undefined, { pdf: pdf.id, docx: docx.id }));
  }

  /** Bloqueia a cotação, verifica o documento e pede as aprovações que as políticas exigirem. */
  private async submit(p: ProposalRow, actor: Actor) {
    const cur = await this.currentVersion(p.id);
    const lockedVersion = cur.status === 'DRAFT' ? await this.quotes.lock(p, cur.id, actor.userId, ['IN_REVIEW']) : null;
    const v = lockedVersion ? await this.currentVersion(p.id) : cur;
    if (v.status !== 'LOCKED' || !v.snapshotJson || !v.snapshotHash) this.fail('NOT_LOCKED', 'A cotação não ficou bloqueada');

    const { pdf, docx } = await this.latestDocs(this.prisma, p.id, v.id);
    if (!pdf || !docx) this.fail('NO_DOCUMENT', 'Gere o documento antes de submeter');
    for (const d of [pdf, docx]) {
      const onDisk = await this.repo.currentHash(d.storageKey);
      if (onDisk !== d.sha256) this.fail('DOCUMENT_CHANGED', `O ficheiro ${d.fileName} foi alterado em disco depois de registado; carregue-o pela aplicação ou gere-o de novo`);
    }
    if (pdf.sourceFingerprint && pdf.sourceFingerprint !== (await currentQuoteFingerprint(this.prisma, p.id))) {
      this.fail('DOCUMENT_STALE', 'A cotação mudou depois de o documento ser gerado (ex.: preços do catálogo). Volte a gerar o documento e submeta de novo.');
    }

    const snap = v.snapshotJson as unknown as { input: Parameters<typeof approvalVars>[0]; result: { totals: Parameters<typeof approvalVars>[1]['totals'] } };
    const legalModified = await this.hasModifiedLegalSection(p.id);
    const vars = approvalVars(snap.input, snap.result as never, legalModified);
    const policies = (await this.prisma.approvalPolicy.findMany()).map((r) => toPolicy(r as never));
    const matched = evaluatePolicies(policies, vars, today());

    await this.prisma.$transaction(async (tx) => {
      // pedidos antigos (ex.: de uma submissão anterior devolvida) já foram fechados; garante que não ficam abertos
      await tx.approvalRequest.updateMany({ where: { proposalId: p.id, status: 'OPEN' }, data: { status: 'CANCELLED', closedAt: new Date() } });
      for (const pol of matched) {
        const id = uuidv7();
        await tx.approvalRequest.create({
          data: {
            id, proposalId: p.id, quoteVersionId: v.id, documentId: pdf.id, policyId: pol.id, policySnapshotJson: pol as never, scope: pol.scope,
            currentLevel: 1, levelDueAt: new Date(Date.now() + pol.levels[0]!.slaHours * 3600_000), snapshotHash: v.snapshotHash!, documentSha256: pdf.sha256, requestedBy: actor.userId,
          },
        });
        await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'proposal', entityId: p.id, action: 'approval.requested', diff: { requestId: id, policy: pol.name, scope: pol.scope, vars } });
        await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'approval.requested', payload: { requestId: id } });
      }
      const to: ProposalStatus = matched.length ? 'PENDING_APPROVAL' : 'APPROVED';
      await this.changeStatus(tx, p, actor, p.status, to, 'SUBMIT', undefined, { snapshotHash: v.snapshotHash, document: pdf.id, requests: matched.length, autoApproved: !matched.length });
      if (!matched.length) await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'proposal.approved', payload: { auto: true } });
    });
  }

  private async hasModifiedLegalSection(proposalId: string): Promise<boolean> {
    const sections = await this.prisma.proposalSection.findMany({ where: { proposalId, isModified: true, blockVersionId: { not: null } } });
    if (!sections.length) return false;
    const versions = await this.prisma.contentBlockVersion.findMany({ where: { id: { in: sections.map((s) => s.blockVersionId!) } }, include: { block: true } });
    return versions.some((v) => v.block.isLegal);
  }

  /** Verifica que o que vai sair é exatamente o que foi aprovado (cotação e documento) e entrega-o. */
  private async send(p: ProposalRow, actor: Actor) {
    if (p.validUntil && day(p.validUntil)! < today()) this.fail('PROPOSAL_EXPIRED', 'A validade da proposta já terminou', 422);
    const v = await this.currentVersion(p.id);
    const check = await this.quotes.verify(p.id, v.id);
    if (!check.valid) this.fail('QUOTE_HASH_MISMATCH', 'O snapshot da cotação não corresponde ao hash aprovado: envio bloqueado');

    const requests = await this.prisma.approvalRequest.findMany({ where: { proposalId: p.id, status: 'APPROVED' } });
    const open = await this.prisma.approvalRequest.count({ where: { proposalId: p.id, status: 'OPEN' } });
    if (open > 0) this.fail('APPROVAL_OPEN', 'Há aprovações ainda por decidir');
    const { pdf, docx } = await this.latestDocs(this.prisma, p.id, v.id);
    if (!pdf || !docx) this.fail('NO_DOCUMENT', 'Não há documento para enviar');

    for (const r of requests) {
      if (r.snapshotHash !== v.snapshotHash) this.fail('QUOTE_HASH_MISMATCH', 'A cotação já não é a que foi aprovada: envio bloqueado');
      if (r.documentId !== pdf.id || r.documentSha256 !== pdf.sha256) this.fail('DOCUMENT_HASH_MISMATCH', 'O documento já não é o que foi aprovado: envio bloqueado');
    }
    for (const d of [pdf, docx]) {
      if ((await this.repo.currentHash(d.storageKey)) !== d.sha256) this.fail('DOCUMENT_HASH_MISMATCH', `O ficheiro ${d.fileName} foi alterado em disco: envio bloqueado`);
    }

    const sent: Array<{ d: typeof pdf; copy: Awaited<ReturnType<DocumentRepository['copyTo']>> }> = [];
    for (const d of [pdf, docx]) {
      const copy = await this.repo.copyTo(d.storageKey, '02_Enviado');
      sent.push({ d, copy });
    }
    await this.prisma.$transaction(async (tx) => {
      for (const { d, copy } of sent) {
        await tx.document.create({
          data: {
            id: uuidv7(), proposalId: p.id, quoteVersionId: v.id, kind: d.kind, origin: d.origin, folder: 'F02_ENVIADO', fileName: d.fileName,
            storageKey: copy.storageKey, sha256: copy.sha256, sizeBytes: copy.sizeBytes, generatedFrom: d.id, sourceFingerprint: d.sourceFingerprint, createdBy: actor.userId,
          },
        });
      }
      await this.changeStatus(tx, p, actor, p.status, 'SENT', 'SEND', undefined, { snapshotHash: v.snapshotHash, pdfSha256: pdf.sha256 }, { sentAt: new Date() });
      await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'proposal.sent', payload: { pdfDocumentId: pdf.id, sentBy: actor.userId } });
    });
  }

  /** Volta a rascunho: se a cotação está bloqueada cria nova versão; fecha ou substitui os pedidos de aprovação. */
  private async backToDraft(p: ProposalRow, actor: Actor, event: WorkflowEvent, reason?: string) {
    const cur = await this.prisma.quoteVersion.findFirst({ where: { proposalId: p.id, isCurrent: true } });
    if (cur?.status === 'LOCKED') await this.quotes.newVersion(p, actor.userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalRequest.updateMany({ where: { proposalId: p.id, status: 'OPEN' }, data: { status: 'CANCELLED', closedAt: new Date() } });
      await tx.approvalRequest.updateMany({ where: { proposalId: p.id, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } });
      await this.changeStatus(tx, p, actor, p.status, 'DRAFT', event, reason, { newQuoteVersion: cur?.status === 'LOCKED' });
    });
  }

  private async setStatus(p: ProposalRow, actor: Actor, to: ProposalStatus, event: WorkflowEvent, reason: string | undefined, opts: { cancelRequests?: 'CANCELLED' } = {}) {
    await this.prisma.$transaction(async (tx) => {
      if (opts.cancelRequests) await tx.approvalRequest.updateMany({ where: { proposalId: p.id, status: 'OPEN' }, data: { status: 'CANCELLED', closedAt: new Date() } });
      await this.changeStatus(tx, p, actor, p.status, to, event, reason);
      await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: `proposal.${to.toLowerCase()}`, payload: { event, reason: reason ?? null } });
    });
  }

  // -- histórico -------------------------------------------------------------------------------

  async timeline(proposalId: string, ability: AppAbility): Promise<TimelineEntryDto[]> {
    await this.proposals.authorized(proposalId, ability, 'read');
    const rows = await this.prisma.auditLog.findMany({ where: { entityType: 'proposal', entityId: proposalId }, orderBy: { seq: 'asc' } });
    const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))];
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: ids } } })).map((u) => [u.id, u.displayName]));
    return rows.map((r) => ({
      occurredAt: r.occurredAt.toISOString(), action: r.action, actorName: r.actorUserId ? users.get(r.actorUserId) ?? null : null,
      detail: (r.diffJson as Record<string, unknown>) ?? {},
    }));
  }

  async requireProposal(id: string) {
    const p = await this.prisma.proposal.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw new NotFoundException('Proposta não encontrada');
    return p;
  }
}
