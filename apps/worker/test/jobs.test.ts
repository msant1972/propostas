import { mkdtemp, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendAudit, createPrisma, migrate, testDatabase, verifyChain, type PrismaClient } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { loadConfig } from '../src/config.js';
import { runAuditExport, runChainVerification, runExpiry, runSlaEscalation } from '../src/jobs/scheduled.js';
import { approversFor, eventHandlers } from '../src/notify/events.js';
import { Notifier } from '../src/notify/notifier.js';

const DB = process.env['TEST_DATABASE_URL'];
const run = describe.skipIf(!DB);

run('tarefas periódicas e notificações', () => {
  let prisma: PrismaClient;
  let outbox: string;
  let mail: string;
  const ids = { owner: uuidv7(), mgr: uuidv7(), mgr2: uuidv7(), fin: uuidv7(), team: uuidv7(), team2: uuidv7(), client: uuidv7(), proposal: uuidv7(), pl: uuidv7(), qv: uuidv7(), doc: uuidv7(), req: uuidv7(), policy: uuidv7() };
  const policy = { id: ids.policy, name: 'P', scope: 'COMMERCIAL', condition: null, mode: 'SEQUENTIAL', priority: 1, isActive: true, validFrom: '2026-01-01', validTo: null, levels: [{ level: 1, role: 'Gestor_Comercial', slaHours: 24, escalateToRole: 'Aprovador_Financeiro' }, { level: 2, role: 'Aprovador_Financeiro', slaHours: 48 }] };
  let cfg: ReturnType<typeof loadConfig>;

  beforeAll(async () => {
    const url = await testDatabase(DB!, 'worker_jobs');
    await migrate(url, 'up');
    prisma = createPrisma(url);
    outbox = await mkdtemp(join(tmpdir(), 'audit-'));
    mail = await mkdtemp(join(tmpdir(), 'mail-'));
    cfg = loadConfig({ DATABASE_URL: url, AUDIT_EXPORT_DIR: outbox, MAIL_OUTBOX_DIR: mail, APP_BASE_URL: 'http://app.test' });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of ['approval_policies', 'audit_log', 'outbox_events', 'approval_decisions', 'approval_requests', 'approval_delegations', 'documents', 'share_links', 'quote_items', 'quote_versions', 'proposals', 'clients', 'price_lists', 'users', 'teams']) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    });
    await prisma.team.createMany({ data: [{ id: ids.team, name: 'Norte' }, { id: ids.team2, name: 'Sul' }] });
    const u = (id: string, name: string, roles: string[], teamId: string | null) => ({ id, email: `${name.toLowerCase()}@x.pt`, displayName: name, rolesJson: roles, teamId });
    await prisma.user.createMany({ data: [u(ids.owner, 'Dono', ['Comercial'], ids.team), u(ids.mgr, 'GestorNorte', ['Gestor_Comercial'], ids.team), u(ids.mgr2, 'GestorSul', ['Gestor_Comercial'], ids.team2), u(ids.fin, 'Financeiro', ['Aprovador_Financeiro'], null)] });
    await prisma.client.create({ data: { id: ids.client, code: 'C', name: 'Cliente', countryCode: 'PT' } });
    await prisma.priceList.create({ data: { id: ids.pl, name: 'L', currency: 'EUR', validFrom: new Date('2026-01-01') } });
    await prisma.proposal.create({ data: { id: ids.proposal, code: 'P-1', title: 'Prop', clientId: ids.client, ownerUserId: ids.owner, ownerTeamId: ids.team, status: 'PENDING_APPROVAL' } });
    await prisma.quoteVersion.create({ data: { id: ids.qv, proposalId: ids.proposal, versionNumber: 1, priceListId: ids.pl, currency: 'EUR', createdBy: ids.owner, grandTotal: '1234.50' } });
    await prisma.document.create({ data: { id: ids.doc, proposalId: ids.proposal, kind: 'PDF', origin: 'GENERATED', folder: 'F01_TRABALHO', fileName: 'a.pdf', storageKey: 'k', sha256: 'a'.repeat(64), sizeBytes: 1 } });
    await prisma.approvalPolicy.create({ data: { id: ids.policy, name: 'P', scope: 'COMMERCIAL', conditionJson: {}, levelsJson: policy.levels as never, validFrom: new Date('2026-01-01') } });
    await prisma.approvalRequest.create({ data: { id: ids.req, proposalId: ids.proposal, quoteVersionId: ids.qv, documentId: ids.doc, policyId: ids.policy, policySnapshotJson: policy as never, scope: 'COMMERCIAL', currentLevel: 1, levelDueAt: new Date(Date.now() - 3600_000), snapshotHash: 'b'.repeat(64), documentSha256: 'a'.repeat(64), requestedBy: ids.owner } });
  });
  afterAll(() => prisma?.$disconnect());

  it('quem aprova o nível comercial: gestores da equipa do dono, nunca o dono nem outra equipa', async () => {
    const r = await approversFor(prisma, ids.req);
    expect(r.people.map((p) => p.name)).toEqual(['GestorNorte']);
    expect(r.role).toBe('Gestor_Comercial');
  });

  it('as delegações acrescentam destinatários', async () => {
    const del = uuidv7();
    await prisma.approvalDelegation.create({ data: { id: del, fromUserId: ids.mgr, toUserId: ids.fin, validFrom: new Date('2026-01-01'), validTo: new Date('2099-01-01') } });
    expect((await approversFor(prisma, ids.req)).people.map((p) => p.name).sort()).toEqual(['Financeiro', 'GestorNorte']);
    await prisma.approvalDelegation.delete({ where: { id: del } });
  });

  it('o pedido de aprovação gera uma mensagem com ligação à decisão (ficheiro .eml sem SMTP)', async () => {
    const notifier = new Notifier(cfg);
    await eventHandlers['approval.requested']!({ prisma, notifier, cfg }, ids.proposal, { requestId: ids.req });
    expect(notifier.history).toHaveLength(1);
    expect(notifier.history[0]).toMatchObject({ subject: 'Aprovação pedida: P-1 — Cliente', link: `http://app.test/aprovacoes/${ids.req}` });
    const files = await readdir(mail);
    expect(files).toHaveLength(1);
    const eml = await readFile(join(mail, files[0]!), 'utf8');
    expect(eml).toContain('gestornorte@x.pt');
    expect(eml).toContain('1234.50 EUR');
  });

  it('SLA: pedido fora de prazo é escalado uma vez e ganha novo prazo', async () => {
    expect(await runSlaEscalation(prisma)).toBe(1);
    expect(await runSlaEscalation(prisma)).toBe(0);
    const r = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: ids.req } });
    expect(r.levelDueAt!.getTime()).toBeGreaterThan(Date.now());
    const events = await prisma.outboxEvent.findMany({ where: { eventType: { in: ['approval.escalated', 'audit.record'] } } });
    expect(events.map((e) => e.eventType).sort()).toEqual(['approval.escalated', 'audit.record']);
  });

  it('expiração: propostas enviadas com validade ultrapassada passam a EXPIRED e revogam ligações', async () => {
    await prisma.proposal.update({ where: { id: ids.proposal }, data: { status: 'SENT', validUntil: new Date('2026-01-31') } });
    await prisma.shareLink.create({ data: { id: uuidv7(), proposalId: ids.proposal, documentId: ids.doc, tokenHash: 'c'.repeat(64), expiresAt: new Date('2099-01-01'), createdBy: ids.owner } });
    expect(await runExpiry(prisma, new Date('2026-10-11T00:00:00Z'))).toBe(1);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: ids.proposal } })).status).toBe('EXPIRED');
    expect((await prisma.shareLink.findFirstOrThrow()).revokedAt).not.toBeNull();
    expect(await runExpiry(prisma, new Date('2026-10-11T00:00:00Z'))).toBe(0);
  });

  it('auditoria: exporta os dias fechados uma só vez, só de leitura, e deteta adulterações', async () => {
    for (const n of [1, 2]) await appendAudit(prisma, { occurredAt: `2026-10-0${n}T10:00:00.000Z`, actorUserId: null, entityType: 'proposal', entityId: ids.proposal, action: `x.${n}`, diff: {} });
    const first = await runAuditExport(prisma, cfg, new Date('2026-10-11T12:00:00Z'));
    expect(first).toEqual(['audit-2026-10-01.jsonl', 'audit-2026-10-02.jsonl']);
    expect(await runAuditExport(prisma, cfg, new Date('2026-10-11T12:00:00Z'))).toEqual([]);
    const f = join(outbox, 'audit-2026-10-01.jsonl');
    expect(((await stat(f)).mode & 0o222)).toBe(0); // sem escrita
    expect(await readFile(`${f}.sha256`, 'utf8')).toMatch(/^[0-9a-f]{64} {2}audit-2026-10-01\.jsonl\n$/);

    expect(await runChainVerification(prisma)).toEqual({ ok: true, checked: 2 });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('DROP TRIGGER trg_audit_no_update');
      await tx.$executeRawUnsafe("UPDATE audit_log SET action = 'adulterada' WHERE seq = (SELECT m FROM (SELECT MIN(seq) AS m FROM audit_log) t)");
      await tx.$executeRawUnsafe("CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only'; END");
    });
    expect((await runChainVerification(prisma)).ok).toBe(false);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'alert.audit_chain_broken' } })).toBe(1);
    expect((await verifyChain(prisma)).brokenAt).toBeDefined();
  });
});
