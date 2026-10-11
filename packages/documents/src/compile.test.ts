import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma, migrate, testDatabase, type PrismaClient } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { compileProposal, CompileError, detectManualEdits, validateProposal } from './compile.js';
import { LocalDocumentRepository, safeSegment } from './repository.js';

const DB = process.env['TEST_DATABASE_URL'];
const run = describe.skipIf(!DB);

describe('LocalDocumentRepository', () => {
  it('nunca sai da raiz e normaliza nomes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'repo-'));
    const repo = new LocalDocumentRepository(root);
    const f = await repo.put({ clientCode: '../../etc', proposalCode: 'P-2026-0001', folder: '01_Trabalho', fileName: '../x ç.docx', bytes: Buffer.from('abc') });
    expect(f.storageKey).toBe('Clientes/etc/P-2026-0001/01_Trabalho/x_c.docx');
    expect(await repo.get(f.storageKey)).toEqual(Buffer.from('abc'));
    await expect(repo.get('../../etc/passwd')).rejects.toThrow(/fora do repositório/);
    expect(() => safeSegment('...')).toThrow();
  });

  it('não sobrescreve ficheiros e copia entre pastas', async () => {
    const repo = new LocalDocumentRepository(await mkdtemp(join(tmpdir(), 'repo-')));
    const input = { clientCode: 'C1', proposalCode: 'P1', folder: '01_Trabalho' as const, fileName: 'a.pdf', bytes: Buffer.from('1') };
    const f = await repo.put(input);
    await expect(repo.put(input)).rejects.toThrow();
    const sent = await repo.copyTo(f.storageKey, '02_Enviado');
    expect(sent.storageKey).toBe('Clientes/C1/P1/02_Enviado/a.pdf');
    expect(sent.sha256).toBe(f.sha256);
    expect(await repo.currentHash('Clientes/C1/P1/01_Trabalho/nao-existe.pdf')).toBeNull();
  });
});

run('compileProposal com MariaDB', () => {
  let prisma: PrismaClient;
  let repo: LocalDocumentRepository;
  let root: string;
  const ids = { user: uuidv7(), client: uuidv7(), proposal: uuidv7(), version: uuidv7(), pl: uuidv7(), prod: uuidv7() };

  beforeAll(async () => {
    const url = await testDatabase(DB!, 'documents');
    await migrate(url, 'up');
    prisma = createPrisma(url);
    root = await mkdtemp(join(tmpdir(), 'docs-'));
    repo = new LocalDocumentRepository(root);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of ['documents', 'section_documents', 'proposal_sections', 'content_block_versions', 'content_blocks', 'quote_items', 'quote_versions', 'proposals', 'clients', 'price_lists', 'products', 'users']) {
        await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
      }
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    });
    await prisma.user.create({ data: { id: ids.user, email: 'a@x.pt', displayName: 'Ana' } });
    await prisma.client.create({ data: { id: ids.client, code: 'CLI-9', name: 'Cliente Nove', countryCode: 'PT', vatNumber: '500000009' } });
    await prisma.product.create({ data: { id: ids.prod, sku: 'S1', name: 'Serviço', billingModel: 'ONE_TIME' } });
    await prisma.priceList.create({ data: { id: ids.pl, name: 'L', currency: 'EUR', validFrom: new Date('2026-01-01') } });
    await prisma.proposal.create({ data: { id: ids.proposal, code: 'P-2026-0100', title: 'Proposta Nove', clientId: ids.client, ownerUserId: ids.user, validUntil: new Date('2026-12-31') } });
    await prisma.quoteVersion.create({ data: { id: ids.version, proposalId: ids.proposal, versionNumber: 1, priceListId: ids.pl, currency: 'EUR', createdBy: ids.user, subtotal: '100', grandTotal: '123', totalTcv: '100' } });
    await prisma.quoteItem.create({ data: { id: uuidv7(), quoteVersionId: ids.version, lineNumber: 1, productId: ids.prod, productNameSnapshot: 'Serviço', quantity: '1', listUnitPrice: '100', unitCost: '40', netUnitPrice: '100', taxRatePercent: '23', taxAmount: '23', lineTotal: '100' } });
  });

  afterAll(() => prisma?.$disconnect());

  it('sem secções não gera', async () => {
    await expect(compileProposal(prisma, repo, { proposalId: ids.proposal, requestedBy: ids.user })).rejects.toMatchObject({ code: 'NO_SECTIONS' });
  });

  it('etiquetas por resolver bloqueiam a geração e não deixam ficheiros', async () => {
    const sid = uuidv7();
    await prisma.proposalSection.create({ data: { id: sid, proposalId: ids.proposal, position: 1, title: 'Texto' } });
    await prisma.sectionDocument.create({ data: { sectionId: sid, ydocState: Buffer.alloc(0), htmlCache: '<p>{{cliente.segredo}} {{cliente.nome}}</p>' } });
    const err = await validateProposal(prisma, ids.proposal).catch((e) => e);
    expect(err).toBeInstanceOf(CompileError);
    expect(err.issues).toEqual([{ tag: 'cliente.segredo', kind: 'UNKNOWN_TAG' }]);
    await expect(compileProposal(prisma, repo, { proposalId: ids.proposal, requestedBy: ids.user })).rejects.toMatchObject({ code: 'MERGE_ISSUES' });
    expect(await prisma.document.count()).toBe(0);
  });

  it('gera DOCX e PDF, grava em 01_Trabalho e regista hashes', async () => {
    await prisma.sectionDocument.update({ where: { sectionId: (await prisma.proposalSection.findFirstOrThrow()).id }, data: { htmlCache: '<p>Para {{cliente.nome}}, válida até {{proposta.validade}}.</p><p>{{tabela_precos}}</p>' } });
    const out = await compileProposal(prisma, repo, { proposalId: ids.proposal, requestedBy: ids.user, now: new Date('2026-10-11T10:00:00Z') });
    expect(out.docx.storageKey).toMatch(/^Clientes\/CLI-9\/P-2026-0100\/01_Trabalho\/P-2026-0100_v1_20261011T100000Z_\w{6}\.docx$/);
    expect(out.pdf.storageKey.endsWith('.pdf')).toBe(true);
    expect((await readFile(repo.fullPath(out.docx.storageKey))).subarray(0, 2).toString()).toBe('PK');
    const rows = await prisma.document.findMany({ orderBy: { kind: 'asc' } });
    expect(rows.map((r) => [r.kind, r.origin, r.folder])).toEqual([['DOCX', 'GENERATED', 'F01_TRABALHO'], ['PDF', 'GENERATED', 'F01_TRABALHO']]);
    expect(rows[0]!.sha256).toBe(out.docx.sha256);
  });

  it('uma segunda geração cria ficheiros novos (o histórico não se perde)', async () => {
    await compileProposal(prisma, repo, { proposalId: ids.proposal, requestedBy: ids.user });
    expect(await prisma.document.count()).toBe(4);
  });

  it('detecta edições manuais pelo hash em disco', async () => {
    expect(await detectManualEdits(prisma, repo, ids.proposal)).toEqual([]);
    const docx = await prisma.document.findFirstOrThrow({ where: { kind: 'DOCX' }, orderBy: { createdAt: 'desc' } });
    await writeFile(repo.fullPath(docx.storageKey), Buffer.from('alterado à mão'));
    expect(await detectManualEdits(prisma, repo, ids.proposal)).toEqual([docx.id]);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: docx.id } })).origin).toBe('MANUALLY_EDITED');
  });
});
