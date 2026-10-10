import { createHash } from 'node:crypto';
import type { PrismaClient } from './generated/client.js';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntry {
  occurredAt: string; // ISO 8601 UTC, fixado no momento do facto (não no da escrita)
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  diff: unknown;
}

/** JSON canónico (chaves ordenadas) para o hash ser reproduzível em qualquer processo. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export const rowHash = (prevHash: string, e: AuditEntry): string =>
  createHash('sha256').update(prevHash + canonicalJson(e)).digest('hex');

/**
 * Acrescenta uma entrada à cadeia. Tem de ser chamada por UM escritor de cada vez (a fila `audit` do worker,
 * com concorrência 1): lê o último hash e insere a seguinte.
 */
export async function appendAudit(prisma: PrismaClient, e: AuditEntry): Promise<{ seq: bigint; rowHash: string }> {
  return prisma.$transaction(async (tx) => {
    const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' } });
    const prev = last?.rowHash ?? GENESIS_HASH;
    const hash = rowHash(prev, e);
    const row = await tx.auditLog.create({
      data: {
        occurredAt: new Date(e.occurredAt), actorUserId: e.actorUserId, entityType: e.entityType, entityId: e.entityId,
        action: e.action, diffJson: (e.diff ?? {}) as never, prevHash: prev, rowHash: hash,
      },
    });
    return { seq: row.seq, rowHash: hash };
  });
}

export interface ChainReport {
  ok: boolean;
  checked: number;
  /** seq da primeira linha que não bate certo, se houver */
  brokenAt?: string;
  reason?: string;
}

const toEntry = (r: { occurredAt: Date; actorUserId: string | null; entityType: string; entityId: string; action: string; diffJson: unknown }): AuditEntry => ({
  occurredAt: r.occurredAt.toISOString(), actorUserId: r.actorUserId, entityType: r.entityType, entityId: r.entityId, action: r.action, diff: r.diffJson,
});

/** Percorre a cadeia por ordem de seq: cada linha tem de apontar para o hash da anterior e o seu hash tem de bater. */
export async function verifyChain(prisma: PrismaClient, batch = 1000): Promise<ChainReport> {
  let prev = GENESIS_HASH;
  let checked = 0;
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await prisma.auditLog.findMany({ orderBy: { seq: 'asc' }, take: batch, ...(cursor !== undefined ? { where: { seq: { gt: cursor } } } : {}) });
    if (rows.length === 0) return { ok: true, checked };
    for (const r of rows) {
      if (r.prevHash !== prev) return { ok: false, checked, brokenAt: String(r.seq), reason: 'prev_hash não corresponde à linha anterior' };
      if (rowHash(prev, toEntry(r)) !== r.rowHash) return { ok: false, checked, brokenAt: String(r.seq), reason: 'o conteúdo da linha foi alterado' };
      prev = r.rowHash;
      checked++;
    }
    cursor = rows[rows.length - 1]!.seq;
  }
}

/** Exporta um dia (UTC) em JSON Lines, com o hash do ficheiro, para guardar fora do alcance da aplicação. */
export async function exportDay(prisma: PrismaClient, day: string): Promise<{ lines: string; sha256: string; count: number }> {
  const from = new Date(`${day}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 864e5);
  const rows = await prisma.auditLog.findMany({ where: { occurredAt: { gte: from, lt: to } }, orderBy: { seq: 'asc' } });
  const lines = rows.map((r) => canonicalJson({ seq: String(r.seq), ...toEntry(r), prevHash: r.prevHash, rowHash: r.rowHash })).join('\n') + (rows.length ? '\n' : '');
  return { lines, sha256: createHash('sha256').update(lines).digest('hex'), count: rows.length };
}

/** Evento de auditoria a gravar no outbox, na mesma transação da alteração de negócio. */
export const AUDIT_EVENT = 'audit.record';
export function auditPayload(e: Omit<AuditEntry, 'occurredAt'> & { occurredAt?: string }): AuditEntry {
  return { ...e, occurredAt: e.occurredAt ?? new Date().toISOString() };
}

/** Impressão digital (SHA-256 do JSON canónico) de um valor qualquer. */
export const fingerprint = (v: unknown): string => createHash('sha256').update(canonicalJson(v)).digest('hex');
