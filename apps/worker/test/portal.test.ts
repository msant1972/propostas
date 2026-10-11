import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma, migrate, testDatabase, type PrismaClient } from '@cpq/db';
import { LocalDocumentRepository } from '@cpq/documents';
import { uuidv7 } from '@cpq/shared';
import { loadConfig } from '../src/config.js';
import { runRetention } from '../src/jobs/scheduled.js';
import { Notifier } from '../src/notify/notifier.js';
import { makeReceipt, sendInvite } from '../src/notify/portal.js';
import { OutboxRelay } from '../src/relay/relay.service.js';

const DB = process.env['TEST_DATABASE_URL'];
const run = describe.skipIf(!DB);

run('portal: convite, comprovativo e retenção', () => {
  let prisma: PrismaClient;
  let repo: LocalDocumentRepository;
  let cfg: ReturnType<typeof loadConfig>;
  let certDir: string;
  const ids = { owner: uuidv7(), client: uuidv7(), proposal: uuidv7(), pl: uuidv7(), qv: uuidv7(), doc: uuidv7(), link: uuidv7(), resp: uuidv7() };
  const token = 'T'.repeat(43);

  beforeAll(async () => {
    const url = await testDatabase(DB!, 'worker_portal');
    await migrate(url, 'up');
    prisma = createPrisma(url);
    certDir = await mkdtemp(join(tmpdir(), 'cert-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '2', '-subj', '/CN=teste', '-keyout', join(certDir, 'k.pem'), '-out', join(certDir, 'c.pem')], { stdio: 'ignore' });
    cfg = loadConfig({ DATABASE_URL: url, MAIL_OUTBOX_DIR: await mkdtemp(join(tmpdir(), 'mail-')), APP_BASE_URL: 'https://propostas.test', TLS_CERT_FILE: join(certDir, 'c.pem'), RETENTION_IP_DAYS: '30', RETENTION_LINK_DAYS: '60' });
    repo = new LocalDocumentRepository(await mkdtemp(join(tmpdir(), 'docs-')));

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of ['customer_responses', 'share_links', 'documents', 'quote_versions', 'proposals', 'clients', 'price_lists', 'users', 'outbox_events', 'audit_log']) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    });
    await prisma.user.create({ data: { id: ids.owner, email: 'dono@x.pt', displayName: 'Dono' } });
    await prisma.client.create({ data: { id: ids.client, code: 'CLI-P', name: 'Cliente P', countryCode: 'PT', contactName: 'Rui', contactEmail: 'rui@cliente.pt' } });
    await prisma.priceList.create({ data: { id: ids.pl, name: 'L', currency: 'EUR', validFrom: new Date('2026-01-01') } });
    await prisma.proposal.create({ data: { id: ids.proposal, code: 'P-9', title: 'Prop', clientId: ids.client, ownerUserId: ids.owner, status: 'SENT' } });
    await prisma.quoteVersion.create({ data: { id: ids.qv, proposalId: ids.proposal, versionNumber: 1, priceListId: ids.pl, currency: 'EUR', createdBy: ids.owner, snapshotHash: 'c'.repeat(64), status: 'LOCKED' } });
    const stored = await repo.put({ clientCode: 'CLI-P', proposalCode: 'P-9', folder: '02_Enviado', fileName: 'P-9.pdf', bytes: Buffer.from('%PDF-1.4 teste') });
    await prisma.document.create({ data: { id: ids.doc, proposalId: ids.proposal, quoteVersionId: ids.qv, kind: 'PDF', origin: 'GENERATED', folder: 'F02_ENVIADO', fileName: 'P-9.pdf', storageKey: stored.storageKey, sha256: stored.sha256, sizeBytes: stored.sizeBytes } });
    await prisma.shareLink.create({ data: { id: ids.link, proposalId: ids.proposal, documentId: ids.doc, tokenHash: 'd'.repeat(64), expiresAt: new Date(Date.now() + 864e5), createdBy: ids.owner } });
    await prisma.customerResponse.create({ data: { id: ids.resp, shareLinkId: ids.link, proposalId: ids.proposal, decision: 'ACCEPTED', signerName: 'Rui Silva', signerEmail: 'rui@cliente.pt', documentSha256: stored.sha256, ipAddress: '203.0.113.7', userAgent: 'UA', decidedAt: new Date(Date.now() - 40 * 864e5) } });
  });
  afterAll(() => prisma?.$disconnect());

  it('o convite leva a ligação e a impressão digital do certificado, e não se envia se a ligação foi revogada', async () => {
    const notifier = new Notifier(cfg);
    await sendInvite({ prisma, repo, notifier, cfg }, ids.proposal, { linkId: ids.link, to: 'rui@cliente.pt', token });
    expect(notifier.history).toHaveLength(1);
    const m = notifier.history[0]!;
    expect(m.to).toEqual([{ name: 'Rui', email: 'rui@cliente.pt' }]);
    expect(m.text).toContain(`https://propostas.test/portal/${token}`);
    expect(m.text).toMatch(/([0-9A-F]{2}:){31}[0-9A-F]{2}/);

    await prisma.shareLink.update({ where: { id: ids.link }, data: { revokedAt: new Date() } });
    await sendInvite({ prisma, repo, notifier, cfg }, ids.proposal, { linkId: ids.link, to: 'rui@cliente.pt', token });
    expect(notifier.history).toHaveLength(1); // nada de novo
    await prisma.shareLink.update({ where: { id: ids.link }, data: { revokedAt: null } });
  });

  it('o token sai do evento quando este termina', async () => {
    const ev = await prisma.outboxEvent.create({ data: { id: uuidv7(), aggregateId: ids.proposal, eventType: 'portal.invite', payload: { linkId: ids.link, to: 'rui@cliente.pt', token }, status: 'PROCESSING' } });
    const relay = new OutboxRelay(prisma, { events: undefined as never, audit: undefined as never }, cfg);
    await relay.markDone(ev.id);
    const after = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: ev.id } });
    expect(after.status).toBe('DONE');
    expect(after.payload).toEqual({ linkId: ids.link, to: 'rui@cliente.pt' });
  });

  it('o comprovativo é gerado uma só vez, em 03_Assinado, com hash registado', async () => {
    const notifier = new Notifier(cfg);
    await makeReceipt({ prisma, repo, notifier, cfg }, ids.proposal, { responseId: ids.resp });
    await makeReceipt({ prisma, repo, notifier, cfg }, ids.proposal, { responseId: ids.resp }); // job repetido
    const docs = await prisma.document.findMany({ where: { kind: 'SIGNED_PDF' } });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ folder: 'F03_ASSINADO', origin: 'GENERATED', generatedFrom: ids.doc });
    expect(docs[0]!.storageKey).toMatch(/^Clientes\/CLI-P\/P-9\/03_Assinado\/P-9_comprovativo_aceitacao_/);
    const bytes = await readFile(repo.fullPath(docs[0]!.storageKey));
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await repo.currentHash(docs[0]!.storageKey)).toBe(docs[0]!.sha256);
    const audit = await prisma.outboxEvent.findMany({ where: { eventType: 'audit.record' } });
    expect(audit.map((a) => (a.payload as { action: string }).action)).toContain('portal.receipt_generated');
  });

  it('retenção: apaga o IP das respostas antigas e as ligações expiradas sem resposta; mantém a prova', async () => {
    const old = uuidv7();
    await prisma.shareLink.create({ data: { id: old, proposalId: ids.proposal, documentId: ids.doc, tokenHash: 'e'.repeat(64), expiresAt: new Date(Date.now() - 90 * 864e5), createdBy: ids.owner } });
    const r = await runRetention(prisma, cfg);
    expect(r).toEqual({ ipsCleared: 1, linksDeleted: 1 });
    const resp = await prisma.customerResponse.findUniqueOrThrow({ where: { id: ids.resp } });
    expect(resp).toMatchObject({ ipAddress: null, userAgent: null, signerName: 'Rui Silva', decision: 'ACCEPTED' });
    expect(await prisma.shareLink.findUnique({ where: { id: old } })).toBeNull();
    expect(await prisma.shareLink.findUnique({ where: { id: ids.link } })).not.toBeNull(); // tem resposta: fica
    expect(await runRetention(prisma, cfg)).toEqual({ ipsCleared: 0, linksDeleted: 0 });
  });
});
