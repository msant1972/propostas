import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PizZip from 'pizzip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDocumentRepository, compileProposal } from '@cpq/documents';
import { boot, resetDb, TEST_DB, type Harness } from './helpers.js';

const run = describe.skipIf(!TEST_DB);

run('conteúdos, secções e documentos', () => {
  let h: Harness;
  let adm: string, com: string, jur: string, ges: string;
  let proposalId: string;
  let approvedVersionId: string, blockId: string, legalVersionId: string;
  let repo: LocalDocumentRepository;
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env['DOCUMENT_STORAGE_DIR'] = await mkdtemp(join(tmpdir(), 'api-docs-'));
    h = await boot();
    await resetDb(h.prisma);
    repo = new LocalDocumentRepository(process.env['DOCUMENT_STORAGE_DIR']!);
    [adm, com, jur, ges] = await Promise.all([h.token('Administrador'), h.token('Comercial'), h.token('Juridico'), h.token('Gestor_Comercial')]);

    // catálogo mínimo para a cotação
    const prod = await h.http().post('/api/v1/catalog/products').set(A(adm)).send({ sku: 'IMP', name: 'Implementação', billingModel: 'ONE_TIME', unitCost: '40' }).expect(201);
    const pl = await h.http().post('/api/v1/price-lists').set(A(adm)).send({ name: 'Geral', currency: 'EUR', validFrom: '2026-01-01' }).expect(201);
    await h.http().put(`/api/v1/price-lists/${pl.body.id}/items`).set(A(adm)).send({ items: [{ productId: prod.body.id, unitPrice: '60' }] }).expect(204);
    await h.http().post('/api/v1/tax-rates').set(A(adm)).send({ countryCode: 'PT', regime: 'STANDARD', ratePercent: '23', validFrom: '2020-01-01' }).expect(201);
    const c = await h.http().post('/api/v1/clients').set(A(com)).send({ code: 'C-DOC', name: 'Cliente Documentos', countryCode: 'PT', vatNumber: '500000001' }).expect(201);
    const p = await h.http().post('/api/v1/proposals').set(A(com)).send({ title: 'Proposta Documentos', clientId: c.body.id, validUntil: '2026-12-31' }).expect(201);
    proposalId = p.body.id;
    const q = await h.http().get(`/api/v1/proposals/${proposalId}/quotes/current`).set(A(com)).expect(200);
    await h.http().put(`/api/v1/proposals/${proposalId}/quotes/${q.body.id}`).set(A(com)).send({ lines: [{ productId: prod.body.id, quantity: '10' }] }).expect(200);
  });
  afterAll(() => h?.close());

  describe('biblioteca de conteúdos', () => {
    it('só gestores, jurídico e administrador criam blocos; o texto é sanitizado', async () => {
      const body = { code: 'INTRO', title: 'Introdução', language: 'pt-PT', reviewDueDate: '2027-01-01', tags: ['Geral', 'intro'], bodyHtml: '<p onclick="x()">Olá {{cliente.nome}}<script>alert(1)</script></p>' };
      await h.http().post('/api/v1/content/blocks').set(A(com)).send(body).expect(403);
      const r = await h.http().post('/api/v1/content/blocks').set(A(ges)).send(body).expect(201);
      blockId = r.body.id;
      expect(r.body.tags).toEqual(['geral', 'intro']);
      expect(r.body.versions[0]).toMatchObject({ versionNumber: 1, status: 'DRAFT', bodyHtml: '<p>Olá {{cliente.nome}}</p>' });
      await h.http().post('/api/v1/content/blocks').set(A(ges)).send(body).expect(409);
    });

    it('etiquetas fora do catálogo são recusadas', async () => {
      const r = await h.http().post('/api/v1/content/blocks').set(A(ges)).send({ code: 'X', title: 'X', language: 'pt-PT', reviewDueDate: '2027-01-01', bodyHtml: '<p>{{cliente.segredo}}</p>' }).expect(422);
      expect(JSON.stringify(r.body)).toContain('cliente.segredo');
    });

    it('quem criou a versão não a aprova; o gestor aprova a de outro; o comercial só vê aprovadas', async () => {
      const v = (await h.http().get(`/api/v1/content/blocks/${blockId}`).set(A(ges))).body.versions[0];
      await h.http().post(`/api/v1/content/blocks/${blockId}/versions/${v.id}/approve`).set(A(ges)).expect(403); // o próprio autor
      expect((await h.http().get('/api/v1/content/blocks').set(A(com))).body.total).toBe(0);
      const ok = await h.http().post(`/api/v1/content/blocks/${blockId}/versions/${v.id}/approve`).set(A(jur)).expect(201);
      approvedVersionId = ok.body.versions[0].id;
      expect(ok.body.versions[0].status).toBe('APPROVED');
      expect((await h.http().get('/api/v1/content/blocks').set(A(com))).body.total).toBe(1);
    });

    it('nova versão aprovada retira a anterior; blocos jurídicos só pelo Jurídico', async () => {
      const nv = await h.http().post(`/api/v1/content/blocks/${blockId}/versions`).set(A(ges)).send({ language: 'pt-PT', reviewDueDate: '2027-06-01', bodyHtml: '<p>Versão 2 {{cliente.nome}}</p>' }).expect(201);
      const v2 = nv.body.versions.find((x: { versionNumber: number }) => x.versionNumber === 2);
      const done = await h.http().post(`/api/v1/content/blocks/${blockId}/versions/${v2.id}/approve`).set(A(jur)).expect(201);
      expect(done.body.versions.map((x: { versionNumber: number; status: string }) => [x.versionNumber, x.status])).toEqual([[2, 'APPROVED'], [1, 'RETIRED']]);
      approvedVersionId = v2.id;

      await h.http().post('/api/v1/content/blocks').set(A(ges)).send({ code: 'LEGAL', title: 'Cláusula', isLegal: true, language: 'pt-PT', reviewDueDate: '2027-01-01', bodyHtml: '<p>Cláusula de confidencialidade.</p>' }).expect(403);
      const legal = await h.http().post('/api/v1/content/blocks').set(A(jur)).send({ code: 'LEGAL', title: 'Cláusula', isLegal: true, language: 'pt-PT', reviewDueDate: '2027-01-01', bodyHtml: '<p>Cláusula de confidencialidade.</p>' }).expect(201);
      const lv = legal.body.versions[0].id;
      await h.http().post(`/api/v1/content/blocks/${legal.body.id}/versions/${lv}/approve`).set(A(ges)).expect(403);
      const approved = await h.http().post(`/api/v1/content/blocks/${legal.body.id}/versions/${lv}/approve`).set(A(adm)).expect(201);
      legalVersionId = approved.body.versions[0].id;
    });

    it('catálogo de variáveis', async () => {
      const r = await h.http().get('/api/v1/content/merge-tags').set(A(com)).expect(200);
      expect(r.body.map((t: { tag: string }) => t.tag)).toContain('{{tabela_precos}}');
    });
  });

  describe('secções da proposta', () => {
    let sectionId: string, rowVersion: number;

    it('só se usam versões aprovadas e uma secção em branco precisa de título', async () => {
      await h.http().post(`/api/v1/proposals/${proposalId}/sections`).set(A(com)).send({}).expect(422);
      const draft = await h.http().post('/api/v1/content/blocks').set(A(ges)).send({ code: 'RASC', title: 'Rascunho', language: 'pt-PT', reviewDueDate: '2027-01-01', bodyHtml: '<p>x</p>' }).expect(201);
      await h.http().post(`/api/v1/proposals/${proposalId}/sections`).set(A(com)).send({ blockVersionId: draft.body.versions[0].id }).expect(422);
    });

    it('adiciona secções a partir de blocos, reordena e edita com bloqueio otimista', async () => {
      await h.http().post(`/api/v1/proposals/${proposalId}/sections`).set(A(com)).send({ blockVersionId: approvedVersionId }).expect(201);
      await h.http().post(`/api/v1/proposals/${proposalId}/sections`).set(A(com)).send({ title: 'Preços' }).expect(201);
      const added = await h.http().post(`/api/v1/proposals/${proposalId}/sections`).set(A(com)).send({ blockVersionId: legalVersionId }).expect(201);
      expect(added.body.map((s: { title: string; position: number }) => [s.position, s.title])).toEqual([[1, 'Introdução'], [2, 'Preços'], [3, 'Cláusula']]);
      expect(added.body[2]).toMatchObject({ isLegal: true, isModified: false });

      const ids = added.body.map((s: { id: string }) => s.id);
      const re = await h.http().put(`/api/v1/proposals/${proposalId}/sections/order`).set(A(com)).send({ orderedIds: [ids[1], ids[0], ids[2]] }).expect(200);
      expect(re.body.map((s: { title: string }) => s.title)).toEqual(['Preços', 'Introdução', 'Cláusula']);
      await h.http().put(`/api/v1/proposals/${proposalId}/sections/order`).set(A(com)).send({ orderedIds: [ids[0]] }).expect(422);

      sectionId = re.body[0].id;
      rowVersion = re.body[0].rowVersion;
      const up = await h.http().put(`/api/v1/proposals/${proposalId}/sections/${sectionId}`).set(A(com)).send({ rowVersion, html: '<p>{{tabela_precos}}</p><p>Total {{cotacao.total}}.</p>' }).expect(200);
      expect(up.body[0].rowVersion).toBe(rowVersion + 1);
      await h.http().put(`/api/v1/proposals/${proposalId}/sections/${sectionId}`).set(A(com)).send({ rowVersion, html: '<p>velho</p>' }).expect(409); // outro editor chegou primeiro
    });

    it('editar um bloco jurídico marca a secção como modificada', async () => {
      const sections = (await h.http().get(`/api/v1/proposals/${proposalId}/sections`).set(A(com))).body;
      const legal = sections.find((s: { isLegal: boolean }) => s.isLegal);
      const r = await h.http().put(`/api/v1/proposals/${proposalId}/sections/${legal.id}`).set(A(com)).send({ rowVersion: legal.rowVersion, html: '<p>Cláusula alterada pelo comercial.</p>' }).expect(200);
      expect(r.body.find((s: { isLegal: boolean }) => s.isLegal).isModified).toBe(true);
    });

    it('outro comercial não vê nem altera as secções', async () => {
      const outro = await h.token('Comercial', '00000000-0000-4000-8000-0000000000c9');
      await h.http().get(`/api/v1/proposals/${proposalId}/sections`).set(A(outro)).expect(404);
    });
  });

  describe('geração de documentos', () => {
    it('etiquetas por resolver bloqueiam o pedido com a lista de problemas', async () => {
      const sections = (await h.http().get(`/api/v1/proposals/${proposalId}/sections`).set(A(com))).body;
      const intro = sections.find((s: { title: string }) => s.title === 'Introdução');
      await h.http().put(`/api/v1/proposals/${proposalId}/sections/${intro.id}`).set(A(com)).send({ rowVersion: intro.rowVersion, html: '<p>NIF {{cliente.nif}} e validade {{proposta.validade}}</p>' }).expect(200);
      // o cliente tem NIF e a proposta validade → resolve; tiramos a validade para provar o bloqueio
      await h.prisma.proposal.update({ where: { id: proposalId }, data: { validUntil: null } });
      const r = await h.http().post(`/api/v1/proposals/${proposalId}/documents/compile`).set(A(com)).expect(422);
      expect(r.body.issues).toEqual([{ tag: 'proposta.validade', kind: 'MISSING_VALUE' }]);
      await h.prisma.proposal.update({ where: { id: proposalId }, data: { validUntil: new Date('2026-12-31') } });
    });

    it('pedido aceite (202) → o worker gera DOCX e PDF → descarregam-se com o conteúdo certo', async () => {
      const r = await h.http().post(`/api/v1/proposals/${proposalId}/documents/compile`).set(A(com)).expect(202);
      const ev = await h.prisma.outboxEvent.findUniqueOrThrow({ where: { id: r.body.eventId } });
      expect(ev).toMatchObject({ eventType: 'document.compile', status: 'PENDING', aggregateId: proposalId });
      expect((await h.http().get(`/api/v1/proposals/${proposalId}/documents/jobs/${r.body.eventId}`).set(A(com))).body.status).toBe('PENDING');

      // o worker real corre noutro processo; aqui executa-se o mesmo código que o seu handler
      await compileProposal(h.prisma, repo, { proposalId, requestedBy: null });

      const docs = (await h.http().get(`/api/v1/proposals/${proposalId}/documents`).set(A(com)).expect(200)).body;
      expect(docs.map((d: { kind: string; origin: string }) => `${d.kind}/${d.origin}`).sort()).toEqual(['DOCX/GENERATED', 'PDF/GENERATED']);

      const docx = docs.find((d: { kind: string }) => d.kind === 'DOCX');
      const dl = await h.http().get(`/api/v1/proposals/${proposalId}/documents/${docx.id}/download`).set(A(com)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(dl.headers['content-type']).toContain('wordprocessingml');
      const xml = new PizZip(dl.body as Buffer).file('word/document.xml')!.asText();
      for (const t of ['Proposta Documentos', 'Cliente Documentos', 'Introdução', '600.00', '738.00', 'Cláusula alterada pelo comercial.']) expect(xml, t).toContain(t);
    });

    it('carregar uma versão editada à mão fica registado sem apagar a gerada', async () => {
      const gen = (await h.http().get(`/api/v1/proposals/${proposalId}/documents`).set(A(com))).body.find((d: { kind: string }) => d.kind === 'DOCX');
      const bytes = (await repo.get((await h.prisma.document.findUniqueOrThrow({ where: { id: gen.id } })).storageKey));
      const up = await h.http().post(`/api/v1/proposals/${proposalId}/documents/upload?kind=DOCX`).set(A(com)).set('Content-Type', 'application/octet-stream').send(bytes).expect(201);
      expect(up.body).toMatchObject({ kind: 'DOCX', origin: 'MANUALLY_EDITED' });
      await h.http().post(`/api/v1/proposals/${proposalId}/documents/upload?kind=PDF`).set(A(com)).set('Content-Type', 'application/octet-stream').send(bytes).expect(422); // não é PDF
      await h.http().post(`/api/v1/proposals/${proposalId}/documents/upload?kind=EXE`).set(A(com)).set('Content-Type', 'application/octet-stream').send(bytes).expect(400);
      expect((await h.http().get(`/api/v1/proposals/${proposalId}/documents`).set(A(com))).body).toHaveLength(3);
    });
  });
});
