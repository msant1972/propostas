import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, exportDay, verifyChain } from '../src/audit.js';
import { createPrisma, type PrismaClient } from '../src/index.js';
import { migrate } from '../src/migrate.js';
import { testDatabase } from '../src/testing.js';

const base = process.env['TEST_DATABASE_URL'];
const run = describe.skipIf(!base);

run('cadeia de auditoria', () => {
  let prisma: PrismaClient;
  const entry = (n: number) => ({ occurredAt: `2026-10-11T10:00:0${n}.000Z`, actorUserId: null, entityType: 'proposal', entityId: '00000000-0000-4000-8000-000000000001', action: `acao.${n}`, diff: { n, nested: { b: 2, a: 1 } } });

  beforeAll(async () => {
    const url = await testDatabase(base!, 'audit');
    await migrate(url, 'up');
    prisma = createPrisma(url);
    await prisma.$executeRawUnsafe('TRUNCATE TABLE audit_log');
    await prisma.$executeRawUnsafe("UPDATE audit_head SET last_hash = REPEAT('0', 64)");
  });
  afterAll(() => prisma?.$disconnect());

  it('cadeia vazia é válida', async () => {
    expect(await verifyChain(prisma)).toEqual({ ok: true, checked: 0 });
  });

  it('entradas encadeadas verificam-se e exportam-se por dia', async () => {
    for (const n of [1, 2, 3]) await appendAudit(prisma, entry(n));
    expect(await verifyChain(prisma, 2)).toEqual({ ok: true, checked: 3 });
    const rows = await prisma.auditLog.findMany({ orderBy: { seq: 'asc' } });
    expect(rows[1]!.prevHash).toBe(rows[0]!.rowHash);
    const ex = await exportDay(prisma, '2026-10-11');
    expect(ex.count).toBe(3);
    expect(ex.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await exportDay(prisma, '2026-10-12')).count).toBe(0);
  });

  it('escritas em simultâneo (vários processos) não quebram a cadeia', async () => {
    const other = createPrisma(process.env['TEST_DATABASE_URL']!.replace(/\/[^/]*$/, `/${new URL(await testDatabase(base!, 'audit')).pathname.slice(1)}`));
    try {
      await Promise.all(Array.from({ length: 30 }, (_, i) => appendAudit(i % 2 ? prisma : other, { ...entry(1), action: `par.${i}`, occurredAt: `2026-10-11T11:00:${String(i).padStart(2, '0')}.000Z` })));
      const r = await verifyChain(prisma);
      expect(r.ok).toBe(true);
      expect(r.checked).toBe(33);
    } finally {
      await other.$disconnect();
    }
  });

  it('a base de dados recusa alterar ou apagar linhas (append-only)', async () => {
    await expect(prisma.$executeRawUnsafe("UPDATE audit_log SET action = 'x'")).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });

  it('uma alteração por fora (sem os triggers) quebra a verificação no ponto exato', async () => {
    // simula um administrador de BD a contornar os triggers
    const seq = (await prisma.auditLog.findFirstOrThrow({ orderBy: { seq: 'asc' }, skip: 1 })).seq;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('DROP TRIGGER trg_audit_no_update');
      await tx.$executeRawUnsafe(`UPDATE audit_log SET action = 'adulterada' WHERE seq = ${seq}`);
      await tx.$executeRawUnsafe(`CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only'; END`);
    });
    expect(await verifyChain(prisma)).toMatchObject({ ok: false, brokenAt: String(seq), reason: 'o conteúdo da linha foi alterado', checked: 1 });
  });
});
