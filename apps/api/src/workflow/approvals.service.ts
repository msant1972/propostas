import { subject } from '@casl/ability';
import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { validatePolicy, type ApprovalPolicy } from '@cpq/rules-engine';
import type { DocumentRepository } from '@cpq/documents';
import type { Prisma as P } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { assertSafeCondition } from '../common/condition-guard.js';
import type { Actor, AppAbility } from '../authz/ability.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import { DOCUMENT_REPO } from '../proposals/documents.service.js';
import { QuotesService } from '../proposals/quotes.service.js';
import { AuditService } from './audit.service.js';
import type {
  ApprovalDetailDto, ApprovalSummaryDto, CreateDelegationDto, CreatePolicyDto, DecideDto, DelegationDto, PolicyDto, UpdatePolicyDto,
} from './workflow.dto.js';
import { toPolicy } from './workflow.service.js';

type Tx = P.TransactionClient;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);

type Request = Awaited<ReturnType<Prisma['approvalRequest']['findFirstOrThrow']>> & { decisions: Array<{ levelNumber: number; decision: string; approverUserId: string }> };

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(DOCUMENT_REPO) private readonly repo: DocumentRepository,
    private readonly quotes: QuotesService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // -- elegibilidade ----------------------------------------------------------------------------

  private levelsOf(r: Request): ApprovalPolicy['levels'] {
    return (r.policySnapshotJson as unknown as ApprovalPolicy).levels;
  }
  private modeOf(r: Request): 'SEQUENTIAL' | 'PARALLEL' {
    return (r.policySnapshotJson as unknown as ApprovalPolicy).mode;
  }

  /** Níveis que ainda aguardam decisão: o atual (sequencial) ou todos os não aprovados (paralelo). */
  private pendingLevels(r: Request) {
    const approved = new Set(r.decisions.filter((d) => d.decision === 'APPROVED').map((d) => d.levelNumber));
    const levels = this.levelsOf(r);
    return this.modeOf(r) === 'SEQUENTIAL' ? levels.filter((l) => l.level === r.currentLevel) : levels.filter((l) => !approved.has(l.level));
  }

  /** Utilizadores que, hoje, delegaram nos `userId`: as suas funções contam também. */
  private async delegatorsOf(userId: string): Promise<string[]> {
    const t = new Date(today());
    return (await this.prisma.approvalDelegation.findMany({ where: { toUserId: userId, validFrom: { lte: t }, validTo: { gte: t } } })).map((d) => d.fromUserId);
  }

  private async rolesOf(userId: string): Promise<string[]> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    return (u?.rolesJson as string[] | null) ?? [];
  }

  /**
   * Quem pode decidir um nível: tem o papel exigido (ou delegação de quem tem), não é o dono da proposta
   * (quatro olhos) e, no nível comercial, pertence à equipa do dono (o administrador está isento da equipa).
   */
  private async eligibility(r: Request, actor: Actor, proposal: { ownerUserId: string; ownerTeamId: string | null }): Promise<{ level: number; onBehalfOf: string | null } | null> {
    if (actor.userId === proposal.ownerUserId) return null;
    if (actor.userId === r.requestedBy) return null; // quem submeteu o pedido também não o decide (quatro olhos)
    const delegators = await this.delegatorsOf(actor.userId);
    for (const lvl of this.pendingLevels(r)) {
      const sameTeam = actor.roles.includes('Administrador') || (!!actor.teamId && actor.teamId === proposal.ownerTeamId); // sem equipa não há aprovação comercial
      if (actor.roles.includes(lvl.role as never) && (r.scope !== 'COMMERCIAL' || lvl.role !== 'Gestor_Comercial' || sameTeam)) return { level: lvl.level, onBehalfOf: null };
      for (const from of delegators) {
        if (from !== proposal.ownerUserId && from !== r.requestedBy && (await this.rolesOf(from)).includes(lvl.role)) return { level: lvl.level, onBehalfOf: from };
      }
    }
    return null;
  }

  // -- consulta ---------------------------------------------------------------------------------

  private async summarize(r: Request, actor: Actor, ctx?: { canSeeMargin: boolean }): Promise<ApprovalSummaryDto & { _p: Awaited<ReturnType<Prisma['proposal']['findFirstOrThrow']>> }> {
    const p = await this.prisma.proposal.findUniqueOrThrow({ where: { id: r.proposalId } });
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: p.clientId } });
    const v = await this.prisma.quoteVersion.findUniqueOrThrow({ where: { id: r.quoteVersionId } });
    const levels = this.levelsOf(r);
    const pending = this.pendingLevels(r);
    const eligible = r.status === 'OPEN' && p.status === 'PENDING_APPROVAL' ? await this.eligibility(r, actor, p) : null;
    void ctx;
    return {
      id: r.id, proposalId: p.id, proposalCode: p.code, proposalTitle: p.title, clientName: client.name, scope: r.scope, status: r.status,
      currentLevel: r.currentLevel, levelCount: levels.length, levelRole: pending[0]?.role ?? null, dueAt: r.levelDueAt?.toISOString() ?? null,
      overdue: r.status === 'OPEN' && !!r.levelDueAt && r.levelDueAt.getTime() < Date.now(), grandTotal: v.grandTotal.toFixed(2), currency: v.currency,
      requestedAt: r.requestedAt.toISOString(), canDecide: !!eligible, _p: p,
    };
  }

  /** Pedidos abertos que o utilizador pode decidir (o seu "caixa de entrada"). */
  async inbox(actor: Actor, includeAll = false): Promise<ApprovalSummaryDto[]> {
    const open = (await this.prisma.approvalRequest.findMany({ where: { status: 'OPEN' }, include: { decisions: true }, orderBy: { requestedAt: 'asc' } })) as Request[];
    const out: ApprovalSummaryDto[] = [];
    for (const r of open) {
      const { _p, ...s } = await this.summarize(r, actor);
      void _p;
      if (s.canDecide || (includeAll && actor.roles.includes('Administrador'))) out.push(s);
    }
    return out;
  }

  async detail(id: string, actor: Actor, canSeeCost: boolean, justDecided = false, ability?: AppAbility): Promise<ApprovalDetailDto> {
    const r = (await this.prisma.approvalRequest.findUnique({ where: { id }, include: { decisions: true } })) as Request | null;
    if (!r) throw new NotFoundException('Pedido não encontrado');
    const { _p: p, ...s } = await this.summarize(r, actor);
    // Acesso a nível de objeto: dono, quem pode decidir, quem já decidiu/delegou, quem vê a proposta (equipa/região) ou administrador.
    const involved = r.decisions.some((d) => d.approverUserId === actor.userId || (d as { onBehalfOfUserId?: string | null }).onBehalfOfUserId === actor.userId);
    const canSee = p.ownerUserId === actor.userId || actor.roles.includes('Administrador') || involved || (!!ability && ability.can('read', subject('Proposal', p as never)));
    if (!justDecided && !s.canDecide && !canSee) throw new NotFoundException('Pedido não encontrado');

    const v = await this.prisma.quoteVersion.findUniqueOrThrow({ where: { id: r.quoteVersionId }, include: { items: true } });
    const owner = await this.prisma.user.findUniqueOrThrow({ where: { id: p.ownerUserId } });
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: r.decisions.flatMap((d) => [d.approverUserId, (d as { onBehalfOfUserId?: string | null }).onBehalfOfUserId].filter((x): x is string => !!x)) } } })).map((u) => [u.id, u.displayName]));
    const docs = await this.prisma.document.findMany({ where: { proposalId: p.id, quoteVersionId: v.id, folder: 'F01_TRABALHO' }, orderBy: { createdAt: 'desc' } });
    const policy = r.policySnapshotJson as unknown as ApprovalPolicy;
    const full = await this.prisma.approvalDecision.findMany({ where: { approvalRequestId: id }, orderBy: { decidedAt: 'asc' } });
    return {
      ...s,
      marginPercent: canSeeCost && v.marginPercent ? v.marginPercent.toFixed(2) : null, tcv: v.totalTcv.toFixed(2),
      maxLineDiscountPercent: v.items.reduce((m, i) => (i.discountPercent.gt(m) ? i.discountPercent : m), v.items[0]?.discountPercent.mul(0) ?? (0 as never)).toString(),
      globalDiscountPercent: v.discountPercent.toFixed(2), policyName: policy.name,
      decisions: full.map((d) => ({ level: d.levelNumber, approverName: names.get(d.approverUserId) ?? '?', onBehalfOfName: d.onBehalfOfUserId ? names.get(d.onBehalfOfUserId) ?? null : null, decision: d.decision, comment: d.comment, decidedAt: d.decidedAt.toISOString() })),
      pdfDocumentId: docs.find((d) => d.kind === 'PDF')?.id ?? null, docxDocumentId: docs.find((d) => d.kind === 'DOCX')?.id ?? null,
      snapshotHash: r.snapshotHash, ownerName: owner.displayName,
    };
  }

  // -- decisão ----------------------------------------------------------------------------------

  async decide(id: string, actor: Actor, dto: DecideDto): Promise<ApprovalDetailDto> {
    const r = (await this.prisma.approvalRequest.findUnique({ where: { id }, include: { decisions: true } })) as Request | null;
    if (!r) throw new NotFoundException('Pedido não encontrado');
    const p = await this.prisma.proposal.findUniqueOrThrow({ where: { id: r.proposalId } });
    if (r.status !== 'OPEN' || p.status !== 'PENDING_APPROVAL') throw new ConflictException({ message: 'Este pedido já não está por decidir', code: 'NOT_OPEN' });
    if (dto.decision !== 'APPROVED' && !dto.comment?.trim()) throw new UnprocessableEntityException({ message: 'Indique o motivo', code: 'REASON_REQUIRED' });

    const who = await this.eligibility(r, actor, p);
    if (!who) throw new ForbiddenException('Não pode decidir este pedido (papel, equipa ou conflito de interesses)');

    // O que se aprova tem de ser exatamente o que foi submetido: cotação e documento.
    const check = await this.quotes.verify(p.id, r.quoteVersionId);
    const doc = await this.prisma.document.findUnique({ where: { id: r.documentId } });
    const onDisk = doc ? await this.repo.currentHash(doc.storageKey) : null;
    if (!check.valid || check.storedHash !== r.snapshotHash || !doc || onDisk !== r.documentSha256) {
      throw new ConflictException({ message: 'A cotação ou o documento mudaram depois do pedido: já não se pode aprovar', code: 'INTEGRITY' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.create({
        data: {
          id: uuidv7(), approvalRequestId: id, levelNumber: who.level, approverUserId: actor.userId, onBehalfOfUserId: who.onBehalfOf,
          decision: dto.decision, comment: dto.comment, snapshotHash: r.snapshotHash, documentSha256: r.documentSha256,
        },
      });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'proposal', entityId: p.id, action: `approval.${dto.decision.toLowerCase()}`, diff: { requestId: id, level: who.level, onBehalfOf: who.onBehalfOf, comment: dto.comment ?? null, snapshotHash: r.snapshotHash, documentSha256: r.documentSha256 } });

      if (dto.decision === 'APPROVED') await this.afterApproval(tx, r, p, actor, who.level);
      else await this.afterRejection(tx, r, p, actor, dto);
    });
    // a cotação aprovada fica no histórico; o rascunho novo cria-se já fora da transação
    if (dto.decision !== 'APPROVED') await this.reopenQuote(p.id, actor.userId);
    return this.detail(id, actor, actor.roles.some((x) => ['Gestor_Comercial', 'Aprovador_Financeiro', 'Administrador'].includes(x)), true);
  }

  private async afterApproval(tx: Tx, r: Request, p: { id: string }, actor: Actor, level: number) {
    const levels = this.levelsOf(r);
    const approved = new Set([...r.decisions.filter((d) => d.decision === 'APPROVED').map((d) => d.levelNumber), level]);
    const done = this.modeOf(r) === 'SEQUENTIAL' ? level >= levels[levels.length - 1]!.level : levels.every((l) => approved.has(l.level));
    if (!done) {
      if (this.modeOf(r) === 'SEQUENTIAL') {
        const next = levels.find((l) => l.level === level + 1)!;
        await tx.approvalRequest.update({ where: { id: r.id }, data: { currentLevel: next.level, levelDueAt: new Date(Date.now() + next.slaHours * 3600_000) } });
        await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'approval.requested', payload: { requestId: r.id } });
      }
      return;
    }
    await tx.approvalRequest.update({ where: { id: r.id }, data: { status: 'APPROVED', closedAt: new Date(), levelDueAt: null } });
    const stillOpen = await tx.approvalRequest.count({ where: { proposalId: p.id, status: 'OPEN', NOT: { id: r.id } } });
    if (stillOpen === 0) {
      await tx.proposal.update({ where: { id: p.id }, data: { status: 'APPROVED', rowVersion: { increment: 1 } } });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'proposal', entityId: p.id, action: 'proposal.status_changed', diff: { from: 'PENDING_APPROVAL', to: 'APPROVED', event: 'APPROVE' } });
      await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'proposal.approved', payload: { requestId: r.id } });
    }
  }

  private async afterRejection(tx: Tx, r: Request, p: { id: string }, actor: Actor, dto: DecideDto) {
    await tx.approvalRequest.update({ where: { id: r.id }, data: { status: dto.decision === 'REJECTED' ? 'REJECTED' : 'RETURNED', closedAt: new Date() } });
    await tx.approvalRequest.updateMany({ where: { proposalId: p.id, status: 'OPEN', NOT: { id: r.id } }, data: { status: 'CANCELLED', closedAt: new Date() } });
    await tx.proposal.update({ where: { id: p.id }, data: { status: 'DRAFT', statusReason: dto.comment ?? null, rowVersion: { increment: 1 } } });
    await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'proposal', entityId: p.id, action: 'proposal.status_changed', diff: { from: 'PENDING_APPROVAL', to: 'DRAFT', event: 'RETURN', reason: dto.comment ?? null, decision: dto.decision } });
    await this.outbox.enqueue(tx, { aggregateId: p.id, eventType: 'proposal.returned', payload: { requestId: r.id, decision: dto.decision, comment: dto.comment ?? null } });
  }

  private async reopenQuote(proposalId: string, actorId: string) {
    const p = await this.prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
    const cur = await this.prisma.quoteVersion.findFirst({ where: { proposalId, isCurrent: true } });
    if (cur?.status === 'LOCKED') await this.quotes.newVersion(p, actorId);
  }

  // -- políticas e delegações -------------------------------------------------------------------

  private policyDto(r: Awaited<ReturnType<Prisma['approvalPolicy']['findFirstOrThrow']>>): PolicyDto {
    const p = toPolicy(r as never);
    return { id: p.id, name: p.name, scope: p.scope, condition: p.condition as Record<string, unknown> | null, mode: p.mode, levels: p.levels, priority: p.priority, isActive: p.isActive, validFrom: p.validFrom, validTo: p.validTo };
  }

  async listPolicies(): Promise<PolicyDto[]> {
    return (await this.prisma.approvalPolicy.findMany({ orderBy: [{ scope: 'asc' }, { priority: 'asc' }] })).map((r) => this.policyDto(r));
  }

  async createPolicy(actor: Actor, dto: CreatePolicyDto): Promise<PolicyDto> {
    assertSafeCondition(dto.condition);
    const problem = validatePolicy({ condition: dto.condition ?? null, mode: dto.mode, levels: dto.levels });
    if (problem) throw new UnprocessableEntityException(problem);
    const r = await this.prisma.$transaction(async (tx) => {
      const row = await tx.approvalPolicy.create({
        data: { id: uuidv7(), name: dto.name, scope: dto.scope, conditionJson: (dto.condition ?? {}) as never, mode: dto.mode, levelsJson: dto.levels as never, priority: dto.priority ?? 100, isActive: dto.isActive ?? true, validFrom: new Date(dto.validFrom), validTo: dto.validTo ? new Date(dto.validTo) : null },
      });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'approval_policy', entityId: row.id, action: 'policy.created', diff: { name: dto.name, scope: dto.scope } });
      return row;
    });
    return this.policyDto(r);
  }

  async updatePolicy(actor: Actor, id: string, dto: UpdatePolicyDto): Promise<PolicyDto> {
    const cur = await this.prisma.approvalPolicy.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Política não encontrada');
    const merged = toPolicy(cur as never);
    const levels = dto.levels ?? merged.levels;
    const condition = dto.condition !== undefined ? dto.condition : merged.condition;
    assertSafeCondition(condition);
    const problem = validatePolicy({ condition, mode: dto.mode ?? merged.mode, levels });
    if (problem) throw new UnprocessableEntityException(problem);
    const r = await this.prisma.$transaction(async (tx) => {
      const row = await tx.approvalPolicy.update({
        where: { id },
        data: {
          ...(dto.name ? { name: dto.name } : {}), ...(dto.scope ? { scope: dto.scope } : {}), ...(dto.condition !== undefined ? { conditionJson: dto.condition as never } : {}),
          ...(dto.mode ? { mode: dto.mode } : {}), ...(dto.levels ? { levelsJson: dto.levels as never } : {}), ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}), ...(dto.validFrom ? { validFrom: new Date(dto.validFrom) } : {}), ...(dto.validTo !== undefined ? { validTo: new Date(dto.validTo) } : {}),
        },
      });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'approval_policy', entityId: id, action: 'policy.updated', diff: dto as never });
      return row;
    });
    return this.policyDto(r);
  }

  async listDelegations(actor: Actor): Promise<DelegationDto[]> {
    const rows = await this.prisma.approvalDelegation.findMany({ where: { fromUserId: actor.userId }, orderBy: { validFrom: 'desc' } });
    const users = new Map((await this.prisma.user.findMany({ where: { id: { in: rows.map((x) => x.toUserId) } } })).map((u) => [u.id, u.displayName]));
    return rows.map((d) => ({ id: d.id, toUserId: d.toUserId, toUserName: users.get(d.toUserId) ?? '?', validFrom: day(d.validFrom)!, validTo: day(d.validTo)! }));
  }

  async createDelegation(actor: Actor, dto: CreateDelegationDto): Promise<DelegationDto> {
    if (dto.toUserId === actor.userId) throw new UnprocessableEntityException('Não pode delegar em si próprio');
    if (dto.validTo < dto.validFrom) throw new UnprocessableEntityException('O fim é anterior ao início');
    const to = await this.prisma.user.findFirst({ where: { id: dto.toUserId, isActive: true } });
    if (!to) throw new UnprocessableEntityException('Utilizador inexistente');
    const d = await this.prisma.$transaction(async (tx) => {
      const row = await tx.approvalDelegation.create({ data: { id: uuidv7(), fromUserId: actor.userId, toUserId: dto.toUserId, validFrom: new Date(dto.validFrom), validTo: new Date(dto.validTo) } });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'delegation', entityId: row.id, action: 'delegation.created', diff: { to: dto.toUserId, from: dto.validFrom, until: dto.validTo } });
      return row;
    });
    return { id: d.id, toUserId: d.toUserId, toUserName: to.displayName, validFrom: dto.validFrom, validTo: dto.validTo };
  }

  async removeDelegation(actor: Actor, id: string): Promise<void> {
    const d = await this.prisma.approvalDelegation.findFirst({ where: { id, fromUserId: actor.userId } });
    if (!d) throw new NotFoundException('Delegação não encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalDelegation.delete({ where: { id } });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'delegation', entityId: id, action: 'delegation.removed' });
    });
  }

  /** Utilizadores ativos a quem se pode delegar (para a UI). */
  async delegationTargets(actor: Actor) {
    const users = await this.prisma.user.findMany({ where: { isActive: true, NOT: { id: actor.userId } }, orderBy: { displayName: 'asc' } });
    return users.map((u) => ({ id: u.id, displayName: u.displayName, email: u.email }));
  }
}
