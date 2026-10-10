import { chmod, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDIT_EVENT, auditPayload, exportDay, verifyChain, type PrismaClient } from '@cpq/db';
import { detectManualEdits, type DocumentRepository } from '@cpq/documents';
import { uuidv7 } from '@cpq/shared';
import type { ApprovalPolicy } from '@cpq/rules-engine';
import type { WorkerConfig } from '../config.js';

const day = (d: Date) => d.toISOString().slice(0, 10);

async function audit(prisma: Pick<PrismaClient, 'outboxEvent'>, entityId: string, action: string, diff: Record<string, unknown>, entityType = 'proposal') {
  await prisma.outboxEvent.create({
    data: { id: uuidv7(), aggregateId: entityId, eventType: AUDIT_EVENT, payload: auditPayload({ actorUserId: null, entityType, entityId, action, diff }) as never },
  });
}

const event = (prisma: Pick<PrismaClient, 'outboxEvent'>, aggregateId: string, eventType: string, payload: Record<string, unknown>) =>
  prisma.outboxEvent.create({ data: { id: uuidv7(), aggregateId, eventType, payload: payload as never } });

/** Pedidos de aprovação fora de prazo: escalam para o papel seguinte (ou repetem o aviso) e ganham novo prazo. */
export async function runSlaEscalation(prisma: PrismaClient, now = new Date()): Promise<number> {
  const late = await prisma.approvalRequest.findMany({ where: { status: 'OPEN', levelDueAt: { lt: now } } });
  for (const r of late) {
    const policy = r.policySnapshotJson as unknown as ApprovalPolicy;
    const level = policy.levels.find((l) => l.level === r.currentLevel) ?? policy.levels[0]!;
    await prisma.$transaction(async (tx) => {
      await tx.approvalRequest.update({ where: { id: r.id }, data: { levelDueAt: new Date(now.getTime() + level.slaHours * 3600_000) } });
      await audit(tx, r.proposalId, 'approval.escalated', { requestId: r.id, level: level.level, role: level.role, escalateToRole: level.escalateToRole ?? null });
      await event(tx, r.proposalId, 'approval.escalated', { requestId: r.id, escalateToRole: level.escalateToRole ?? 'Administrador' });
    });
  }
  return late.length;
}

/** Propostas enviadas cuja validade terminou passam a EXPIRED. */
export async function runExpiry(prisma: PrismaClient, now = new Date()): Promise<number> {
  const due = await prisma.proposal.findMany({ where: { status: 'SENT', validUntil: { lt: new Date(day(now)) }, deletedAt: null } });
  for (const p of due) {
    await prisma.$transaction(async (tx) => {
      const res = await tx.proposal.updateMany({ where: { id: p.id, status: 'SENT' }, data: { status: 'EXPIRED', statusReason: 'Validade terminada', rowVersion: { increment: 1 } } });
      if (res.count === 0) return;
      await tx.shareLink.updateMany({ where: { proposalId: p.id, revokedAt: null }, data: { revokedAt: now } });
      await audit(tx, p.id, 'proposal.status_changed', { from: 'SENT', to: 'EXPIRED', event: 'EXPIRE', validUntil: day(p.validUntil!) });
      await event(tx, p.id, 'proposal.expired', {});
    });
  }
  return due.length;
}

/** Exporta os dias fechados ainda em falta para ficheiros só de leitura (e o respetivo hash). */
export async function runAuditExport(prisma: PrismaClient, cfg: Pick<WorkerConfig, 'AUDIT_EXPORT_DIR'>, now = new Date()): Promise<string[]> {
  const first = await prisma.auditLog.findFirst({ orderBy: { occurredAt: 'asc' } });
  if (!first) return [];
  await mkdir(cfg.AUDIT_EXPORT_DIR, { recursive: true });
  const existing = new Set(await readdir(cfg.AUDIT_EXPORT_DIR));
  const written: string[] = [];
  for (let d = new Date(day(first.occurredAt)); day(d) < day(now); d = new Date(d.getTime() + 864e5)) {
    const name = `audit-${day(d)}.jsonl`;
    if (existing.has(name)) continue;
    const ex = await exportDay(prisma, day(d));
    if (ex.count === 0) continue;
    const file = join(cfg.AUDIT_EXPORT_DIR, name);
    await writeFile(file, ex.lines, { flag: 'wx', mode: 0o440 });
    await writeFile(`${file}.sha256`, `${ex.sha256}  ${name}\n`, { flag: 'wx', mode: 0o440 });
    await chmod(file, 0o440);
    written.push(name);
  }
  return written;
}

/** Verifica a cadeia; se estiver quebrada, deixa um alerta no outbox (email aos administradores). */
export async function runChainVerification(prisma: PrismaClient): Promise<{ ok: boolean; checked: number }> {
  const report = await verifyChain(prisma);
  if (!report.ok) await event(prisma, uuidv7(), 'alert.audit_chain_broken', { brokenAt: report.brokenAt, reason: report.reason });
  return { ok: report.ok, checked: report.checked };
}

export async function runManualEditCheck(prisma: PrismaClient, repo: DocumentRepository): Promise<string[]> {
  const ids = await detectManualEdits(prisma, repo);
  for (const id of ids) {
    const d = await prisma.document.findUniqueOrThrow({ where: { id } });
    await audit(prisma, d.proposalId, 'document.manually_edited', { documentId: id, fileName: d.fileName });
  }
  return ids;
}
