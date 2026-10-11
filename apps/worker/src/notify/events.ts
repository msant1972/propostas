import { AUDIT_EVENT, appendAudit, type AuditEntry, type PrismaClient } from '@cpq/db';
import type { ApprovalPolicy } from '@cpq/rules-engine';
import type { WorkerConfig } from '../config.js';
import type { Notifier } from './notifier.js';
import { delegatesOf, uniquePeople, usersWithRole, type Person } from './recipients.js';

interface Ctx {
  prisma: PrismaClient;
  notifier: Notifier;
  cfg: WorkerConfig;
}

const link = (cfg: WorkerConfig, path: string) => `${cfg.APP_BASE_URL.replace(/\/$/, '')}${path}`;
const person = (u: { id: string; displayName: string; email: string }): Person => ({ id: u.id, name: u.displayName, email: u.email });

async function proposalOf(prisma: PrismaClient, id: string) {
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id } });
  const [client, owner, version] = await Promise.all([
    prisma.client.findUniqueOrThrow({ where: { id: p.clientId } }),
    prisma.user.findUniqueOrThrow({ where: { id: p.ownerUserId } }),
    prisma.quoteVersion.findFirst({ where: { proposalId: id, isCurrent: true } }),
  ]);
  return { p, client, owner, total: version ? `${version.grandTotal.toFixed(2)} ${version.currency}` : '' };
}

/** Quem deve decidir o nível pendente de um pedido (papel, equipa e delegados), sem o dono da proposta. */
export async function approversFor(prisma: PrismaClient, requestId: string): Promise<{ people: Person[]; role: string; scope: string }> {
  const r = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: requestId } });
  const policy = r.policySnapshotJson as unknown as ApprovalPolicy;
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id: r.proposalId } });
  const decided = new Set((await prisma.approvalDecision.findMany({ where: { approvalRequestId: requestId, decision: 'APPROVED' } })).map((d) => d.levelNumber));
  const pending = policy.mode === 'SEQUENTIAL' ? policy.levels.filter((l) => l.level === r.currentLevel) : policy.levels.filter((l) => !decided.has(l.level));
  const direct = (await Promise.all(pending.map((l) => usersWithRole(prisma, l.role, { teamId: r.scope === 'COMMERCIAL' ? p.ownerTeamId : null, excludeUserId: p.ownerUserId })))).flat();
  const delegates = (await delegatesOf(prisma, direct.map((d) => d.id))).filter((d) => d.id !== p.ownerUserId);
  return { people: uniquePeople(direct, delegates), role: pending.map((l) => l.role).join(', '), scope: r.scope };
}

export const eventHandlers: Record<string, (ctx: Ctx, aggregateId: string, payload: Record<string, unknown>) => Promise<void>> = {
  'approval.requested': async ({ prisma, notifier, cfg }, proposalId, payload) => {
    const requestId = String(payload['requestId']);
    const { p, client, owner, total } = await proposalOf(prisma, proposalId);
    const { people, role, scope } = await approversFor(prisma, requestId);
    await notifier.send({
      to: people,
      subject: `Aprovação pedida: ${p.code} — ${client.name}`,
      text: `${owner.displayName} submeteu a proposta "${p.title}" (${p.code}) para aprovação ${scope === 'LEGAL' ? 'jurídica' : 'comercial'}.\nCliente: ${client.name}\nValor: ${total}\nNível pendente: ${role}`,
      link: link(cfg, `/aprovacoes/${requestId}`),
    });
  },
  'approval.escalated': async ({ prisma, notifier, cfg }, proposalId, payload) => {
    const { p, client } = await proposalOf(prisma, proposalId);
    const role = String(payload['escalateToRole'] ?? 'Administrador');
    const people = await usersWithRole(prisma, role);
    await notifier.send({ to: people, subject: `Aprovação em atraso: ${p.code}`, text: `O pedido de aprovação da proposta ${p.code} (${client.name}) ultrapassou o prazo e foi escalado.`, link: link(cfg, `/aprovacoes/${String(payload['requestId'])}`) });
  },
  'proposal.approved': async ({ prisma, notifier, cfg }, proposalId) => {
    const { p, owner, client } = await proposalOf(prisma, proposalId);
    await notifier.send({ to: [person(owner)], subject: `Proposta aprovada: ${p.code}`, text: `A proposta "${p.title}" (${client.name}) foi aprovada e pode ser enviada ao cliente.`, link: link(cfg, `/propostas/${p.id}`) });
  },
  'proposal.returned': async ({ prisma, notifier, cfg }, proposalId, payload) => {
    const { p, owner } = await proposalOf(prisma, proposalId);
    await notifier.send({ to: [person(owner)], subject: `Proposta devolvida: ${p.code}`, text: `A proposta "${p.title}" foi devolvida para correção.\nMotivo: ${String(payload['comment'] ?? '—')}`, link: link(cfg, `/propostas/${p.id}`) });
  },
  'proposal.accepted': async ({ prisma, notifier, cfg }, proposalId) => {
    const { p, owner, client } = await proposalOf(prisma, proposalId);
    await notifier.send({ to: [person(owner)], subject: `Proposta aceite: ${p.code}`, text: `${client.name} aceitou a proposta "${p.title}".`, link: link(cfg, `/propostas/${p.id}`) });
  },
  'proposal.rejected': async ({ prisma, notifier, cfg }, proposalId, payload) => {
    const { p, owner, client } = await proposalOf(prisma, proposalId);
    await notifier.send({ to: [person(owner)], subject: `Proposta recusada: ${p.code}`, text: `${client.name} recusou a proposta "${p.title}".\n${String(payload['reason'] ?? '')}`, link: link(cfg, `/propostas/${p.id}`) });
  },
  'portal.opened': async ({ prisma, notifier, cfg }, proposalId) => {
    const { p, owner, client } = await proposalOf(prisma, proposalId);
    await notifier.send({ to: [person(owner)], subject: `O cliente abriu a proposta ${p.code}`, text: `${client.name} abriu pela primeira vez a proposta "${p.title}" no portal.`, link: link(cfg, `/propostas/${p.id}`) });
  },
  'proposal.expired': async ({ prisma, notifier, cfg }, proposalId) => {
    const { p, owner, client } = await proposalOf(prisma, proposalId);
    await notifier.send({ to: [person(owner)], subject: `Proposta expirada: ${p.code}`, text: `A validade da proposta "${p.title}" (${client.name}) terminou sem resposta.`, link: link(cfg, `/propostas/${p.id}`) });
  },
  'alert.audit_chain_broken': async ({ prisma, notifier }, _id, payload) => {
    await notifier.send({ to: await usersWithRole(prisma, 'Administrador'), subject: 'ALERTA: cadeia de auditoria quebrada', text: `A verificação noturna encontrou uma inconsistência na linha ${String(payload['brokenAt'])}: ${String(payload['reason'])}.` });
  },
};

/** Acrescenta uma entrada à cadeia de auditoria (processada pela fila `audit`, com concorrência 1). */
export async function appendFromEvent(prisma: PrismaClient, payload: Record<string, unknown>): Promise<void> {
  await appendAudit(prisma, payload as unknown as AuditEntry);
}

export { AUDIT_EVENT };
