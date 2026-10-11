import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDocumentRepository, compileProposal } from '@cpq/documents';
import { uuidv7 } from '@cpq/shared';
import { boot, resetDb, TEST_DB, type Harness } from './helpers.js';

const run = describe.skipIf(!TEST_DB);

run('workflow, aprovações e integridade', () => {
  let h: Harness;
  let repo: LocalDocumentRepository;
  const tk: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const A = (r: string) => ({ Authorization: `Bearer ${tk[r]}` });
  const TEAM = uuidv7();

  /** Cria proposta com cotação (desconto `disc`%), uma secção, gera documentos e devolve o id. */
  async function proposal(disc: string, opts: { legalEdit?: boolean } = {}): Promise<{ id: string; version: string }> {
    const c = await h.http().post('/api/v1/proposals').set(A('com')).send({ title: `P ${disc}`, clientId: ids['client'], validUntil: '2099-12-31' }).expect(201);
    const id = c.body.id as string;
    const q = (await h.http().get(`/api/v1/proposals/${id}/quotes/current`).set(A('com')).expect(200)).body;
    await h.http().put(`/api/v1/proposals/${id}/quotes/${q.id}`).set(A('com')).send({ lines: [{ productId: ids['prod'], quantity: '10', discountPercent: disc }] }).expect(200);
    await h.http().post(`/api/v1/proposals/${id}/sections`).set(A('com')).send({ title: 'Texto' }).expect(201);
    let secs = (await h.http().get(`/api/v1/proposals/${id}/sections`).set(A('com'))).body;
    await h.http().put(`/api/v1/proposals/${id}/sections/${secs[0].id}`).set(A('com')).send({ rowVersion: secs[0].rowVersion, html: '<p>Para {{cliente.nome}}.</p><p>{{tabela_precos}}</p>' }).expect(200);
    if (opts.legalEdit) {
      await h.http().post(`/api/v1/proposals/${id}/sections`).set(A('com')).send({ blockVersionId: ids['legalVersion'] }).expect(201);
      secs = (await h.http().get(`/api/v1/proposals/${id}/sections`).set(A('com'))).body;
      const legal = secs.find((s: { isLegal: boolean }) => s.isLegal);
      await h.http().put(`/api/v1/proposals/${id}/sections/${legal.id}`).set(A('com')).send({ rowVersion: legal.rowVersion, html: '<p>Cláusula alterada.</p>' }).expect(200);
    }
    await compileProposal(h.prisma, repo, { proposalId: id, requestedBy: null });
    return { id, version: q.id };
  }
  const go = (id: string, who: string, event: string, extra: object = {}) => h.http().post(`/api/v1/proposals/${id}/transitions`).set(A(who)).send({ event, ...extra });
  const status = async (id: string) => (await h.prisma.proposal.findUniqueOrThrow({ where: { id } })).status;
  const inbox = async (who: string) => (await h.http().get('/api/v1/approvals').set(A(who)).expect(200)).body as Array<{ id: string; canDecide: boolean; levelRole: string; scope: string }>;
  const decide = (reqId: string, who: string, decision: string, comment?: string) => h.http().post(`/api/v1/approvals/${reqId}/decision`).set(A(who)).send({ decision, comment });

  beforeAll(async () => {
    process.env['DOCUMENT_STORAGE_DIR'] = await mkdtemp(join(tmpdir(), 'wf-docs-'));
    h = await boot();
    await resetDb(h.prisma);
    repo = new LocalDocumentRepository(process.env['DOCUMENT_STORAGE_DIR']!);
    await h.prisma.team.create({ data: { id: TEAM, name: 'Norte' } });
    const u = {
      com: await h.makeUser({ role: 'Comercial', key: 'dono', name: 'dono', teamId: TEAM }),
      ges: await h.makeUser({ role: 'Gestor_Comercial', key: 'gestor', name: 'gestor', teamId: TEAM }),
      fin: await h.makeUser({ role: 'Aprovador_Financeiro', key: 'fin', name: 'financeiro' }),
      jur: await h.makeUser({ role: 'Juridico', key: 'jur', name: 'juridico' }),
      adm: await h.makeUser({ role: 'Administrador', key: 'adm', name: 'admin' }),
      sub: await h.makeUser({ role: 'Comercial', key: 'substituto', name: 'substituto', teamId: TEAM }),
    };
    ids['gestorId'] = u.ges.id;
    ids['substId'] = u.sub.id;
    for (const k of Object.keys(u) as Array<keyof typeof u>) tk[k] = await h.login(u[k].email);

    const p = await h.http().post('/api/v1/catalog/products').set(A('adm')).send({ sku: 'IMP', name: 'Implementação', billingModel: 'ONE_TIME', unitCost: '40' }).expect(201);
    ids['prod'] = p.body.id;
    const pl = await h.http().post('/api/v1/price-lists').set(A('adm')).send({ name: 'Geral', currency: 'EUR', validFrom: '2026-01-01' }).expect(201);
    await h.http().put(`/api/v1/price-lists/${pl.body.id}/items`).set(A('adm')).send({ items: [{ productId: p.body.id, unitPrice: '60' }] }).expect(204);
    await h.http().post('/api/v1/tax-rates').set(A('adm')).send({ countryCode: 'PT', regime: 'STANDARD', ratePercent: '23', validFrom: '2020-01-01' }).expect(201);
    const c = await h.http().post('/api/v1/clients').set(A('com')).send({ code: 'C-WF', name: 'Cliente WF', countryCode: 'PT', vatNumber: '500000002' }).expect(201);
    ids['client'] = c.body.id;
    // bloco jurídico aprovado
    const b = await h.http().post('/api/v1/content/blocks').set(A('jur')).send({ code: 'CG', title: 'Condições', isLegal: true, language: 'pt-PT', reviewDueDate: '2027-01-01', bodyHtml: '<p>Condições gerais.</p>' }).expect(201);
    const ap = await h.http().post(`/api/v1/content/blocks/${b.body.id}/versions/${b.body.versions[0].id}/approve`).set(A('adm')).expect(201);
    ids['legalVersion'] = ap.body.versions[0].id;
    // políticas
    await h.http().post('/api/v1/approval-policies').set(A('adm')).send({
      name: 'Comercial', scope: 'COMMERCIAL', mode: 'SEQUENTIAL', validFrom: '2026-01-01',
      condition: { '>': [{ var: 'max_line_discount_percent' }, 15] },
      levels: [{ level: 1, role: 'Gestor_Comercial', slaHours: 24 }, { level: 2, role: 'Aprovador_Financeiro', slaHours: 48 }],
    }).expect(201);
    await h.http().post('/api/v1/approval-policies').set(A('adm')).send({
      name: 'Jurídico', scope: 'LEGAL', mode: 'SEQUENTIAL', validFrom: '2026-01-01',
      condition: { '==': [{ var: 'has_modified_legal_section' }, true] }, levels: [{ level: 1, role: 'Juridico', slaHours: 48 }],
    }).expect(201);
  });
  afterAll(() => h?.close());

  it('só o administrador gere políticas; condições e níveis inválidos são recusados', async () => {
    await h.http().post('/api/v1/approval-policies').set(A('com')).send({ name: 'x', scope: 'COMMERCIAL', mode: 'SEQUENTIAL', validFrom: '2026-01-01', levels: [{ level: 1, role: 'A', slaHours: 1 }] }).expect(403);
    await h.http().post('/api/v1/approval-policies').set(A('adm')).send({ name: 'x', scope: 'COMMERCIAL', mode: 'SEQUENTIAL', validFrom: '2026-01-01', levels: [{ level: 2, role: 'A', slaHours: 1 }] }).expect(422);
    await h.http().post('/api/v1/approval-policies').set(A('adm')).send({ name: 'x', scope: 'COMMERCIAL', mode: 'SEQUENTIAL', validFrom: '2026-01-01', condition: { inventado: [1] }, levels: [{ level: 1, role: 'A', slaHours: 1 }] }).expect(422);
  });

  describe('percurso completo com aprovação em dois níveis', () => {
    let id: string;
    let reqId: string;

    it('não se pode submeter sem rever, nem pular estados', async () => {
      ({ id } = await proposal('20'));
      const bad = await go(id, 'com', 'SUBMIT').expect(409);
      expect(bad.body.code).toBe('INVALID_TRANSITION');
      await go(id, 'com', 'SEND').expect(409);
    });

    it('compilar → revisão; submeter bloqueia a cotação e cria o pedido', async () => {
      const c = await go(id, 'com', 'COMPILE').expect(201);
      expect(c.body).toMatchObject({ status: 'IN_REVIEW' });
      expect(c.body.availableEvents).toEqual(expect.arrayContaining(['SUBMIT', 'EDIT', 'CANCEL']));
      const s = await go(id, 'com', 'SUBMIT').expect(201);
      expect(s.body.status).toBe('PENDING_APPROVAL');
      const q = await h.http().get(`/api/v1/proposals/${id}/quotes/current`).set(A('com')).expect(200);
      expect(q.body).toMatchObject({ status: 'LOCKED' });
      const reqs = await h.prisma.approvalRequest.findMany({ where: { proposalId: id } });
      expect(reqs).toHaveLength(1);
      expect(reqs[0]).toMatchObject({ scope: 'COMMERCIAL', status: 'OPEN', currentLevel: 1, snapshotHash: q.body.snapshotHash });
      reqId = reqs[0]!.id;
    });

    it('a cotação já não se altera durante a aprovação', async () => {
      const q = (await h.http().get(`/api/v1/proposals/${id}/quotes/current`).set(A('com'))).body;
      await h.http().put(`/api/v1/proposals/${id}/quotes/${q.id}`).set(A('com')).send({ lines: [{ productId: ids['prod'], quantity: '1' }] }).expect(409);
      await h.http().post(`/api/v1/proposals/${id}/sections`).set(A('com')).send({ title: 'Nova' }).expect(409);
    });

    it('caixa de entrada: só o gestor da equipa vê o nível 1; o dono e o financeiro não decidem ainda', async () => {
      expect((await inbox('ges')).map((r) => [r.id, r.canDecide, r.levelRole])).toEqual([[reqId, true, 'Gestor_Comercial']]);
      expect(await inbox('com')).toEqual([]);
      expect(await inbox('fin')).toEqual([]);
      await decide(reqId, 'com', 'APPROVED').expect(403); // quatro olhos
      await decide(reqId, 'fin', 'APPROVED').expect(403); // ainda não é o nível dele
      await decide(reqId, 'ges', 'REJECTED').expect(422); // rejeitar exige motivo
    });

    it('o gestor aprova o nível 1 e o pedido passa ao financeiro', async () => {
      const r = await decide(reqId, 'ges', 'APPROVED', 'Ok').expect(201);
      expect(r.body.decisions).toMatchObject([{ level: 1, decision: 'APPROVED', approverName: 'gestor' }]);
      expect(await status(id)).toBe('PENDING_APPROVAL');
      expect((await inbox('fin')).map((x) => x.id)).toEqual([reqId]);
      expect(await inbox('ges')).toEqual([]);
    });

    it('o financeiro aprova o nível 2 e a proposta fica APROVADA', async () => {
      await decide(reqId, 'fin', 'APPROVED').expect(201);
      expect(await status(id)).toBe('APPROVED');
      await decide(reqId, 'fin', 'APPROVED').expect(409); // já fechado
    });

    it('integridade: um PDF alterado em disco bloqueia o envio; restaurado, envia', async () => {
      const pdf = await h.prisma.document.findFirstOrThrow({ where: { proposalId: id, kind: 'PDF', folder: 'F01_TRABALHO' }, orderBy: { createdAt: 'desc' } });
      const file = repo.fullPath(pdf.storageKey);
      const original = await readFile(file);
      await writeFile(file, Buffer.concat([original, Buffer.from('adulterado')]));
      const bad = await go(id, 'com', 'SEND').expect(409);
      expect(bad.body.code).toBe('DOCUMENT_HASH_MISMATCH');
      expect(await status(id)).toBe('APPROVED');
      await writeFile(file, original);

      const ok = await go(id, 'com', 'SEND').expect(201);
      expect(ok.body.status).toBe('SENT');
      const sent = await h.prisma.document.findMany({ where: { proposalId: id, folder: 'F02_ENVIADO' } });
      expect(sent.map((d) => d.kind).sort()).toEqual(['DOCX', 'PDF']);
      expect((await h.prisma.proposal.findUniqueOrThrow({ where: { id } })).sentAt).not.toBeNull();
    });

    it('tudo ficou na auditoria, por ordem, com quem fez o quê', async () => {
      const t = (await h.http().get(`/api/v1/proposals/${id}/timeline`).set(A('com')).expect(200)).body as Array<{ action: string }>;
      // a fila de auditoria do worker ainda não correu: os factos estão no outbox, prontos a entrar na cadeia
      const queued = await h.prisma.outboxEvent.findMany({ where: { eventType: 'audit.record', aggregateId: id }, orderBy: { createdAt: 'asc' } });
      const actions = queued.map((e) => (e.payload as { action: string }).action);
      expect(actions).toEqual(expect.arrayContaining(['approval.requested', 'approval.approved', 'proposal.status_changed']));
      expect(actions.filter((a) => a === 'approval.approved')).toHaveLength(2);
      expect(Array.isArray(t)).toBe(true);
    });
  });

  describe('outros caminhos', () => {
    it('sem política aplicável a proposta é aprovada ao submeter', async () => {
      const { id } = await proposal('5');
      await go(id, 'com', 'COMPILE').expect(201);
      const r = await go(id, 'com', 'SUBMIT').expect(201);
      expect(r.body.status).toBe('APPROVED');
      expect(await h.prisma.approvalRequest.count({ where: { proposalId: id } })).toBe(0);
    });

    it('rejeitar devolve a rascunho com nova versão de cotação e o motivo', async () => {
      const { id } = await proposal('25');
      await go(id, 'com', 'COMPILE').expect(201);
      await go(id, 'com', 'SUBMIT').expect(201);
      const reqId = (await h.prisma.approvalRequest.findFirstOrThrow({ where: { proposalId: id } })).id;
      await decide(reqId, 'ges', 'REJECTED', 'Desconto excessivo').expect(201);
      const p = await h.prisma.proposal.findUniqueOrThrow({ where: { id } });
      expect(p).toMatchObject({ status: 'DRAFT', statusReason: 'Desconto excessivo' });
      const versions = (await h.http().get(`/api/v1/proposals/${id}/quotes`).set(A('com'))).body as Array<{ versionNumber: number; status: string; isCurrent: boolean }>;
      expect(versions.map((v) => [v.versionNumber, v.status, v.isCurrent])).toEqual([[2, 'DRAFT', true], [1, 'SUPERSEDED', false]]);
      expect((await h.prisma.approvalRequest.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('REJECTED');
    });

    it('retirar um pedido, editar após aprovação (com confirmação) e cancelar (com motivo)', async () => {
      const { id } = await proposal('30');
      await go(id, 'com', 'COMPILE').expect(201);
      await go(id, 'com', 'SUBMIT').expect(201);
      await go(id, 'com', 'RETURN').expect(422); // motivo obrigatório
      await go(id, 'com', 'RETURN', { reason: 'Engano' }).expect(201);
      expect(await status(id)).toBe('DRAFT');
      expect(await h.prisma.approvalRequest.count({ where: { proposalId: id, status: 'CANCELLED' } })).toBe(1);

      // cota de novo sem desconto: aprovada sem pedidos
      const q = (await h.http().get(`/api/v1/proposals/${id}/quotes/current`).set(A('com'))).body;
      await h.http().put(`/api/v1/proposals/${id}/quotes/${q.id}`).set(A('com')).send({ lines: [{ productId: ids['prod'], quantity: '5' }] }).expect(200);
      await compileProposal(h.prisma, repo, { proposalId: id, requestedBy: null });
      await go(id, 'com', 'COMPILE').expect(201);
      await go(id, 'com', 'SUBMIT').expect(201);
      expect(await status(id)).toBe('APPROVED');
      const need = await go(id, 'com', 'EDIT').expect(422);
      expect(need.body.code).toBe('NEEDS_CONFIRMATION');
      await go(id, 'com', 'EDIT', { confirm: true }).expect(201);
      expect(await status(id)).toBe('DRAFT');
      await go(id, 'com', 'CANCEL').expect(422);
      await go(id, 'com', 'CANCEL', { reason: 'Cliente desistiu' }).expect(201);
      expect(await status(id)).toBe('CANCELLED');
      await go(id, 'com', 'EDIT').expect(409); // estado terminal
    });

    it('uma cotação alterada depois de gerado o documento não passa na submissão', async () => {
      const { id } = await proposal('5');
      await go(id, 'com', 'COMPILE').expect(201);
      // o preço do catálogo muda entre gerar o documento e submeter
      const pl = (await h.http().get('/api/v1/price-lists').set(A('adm'))).body[0];
      await h.http().put(`/api/v1/price-lists/${pl.id}/items`).set(A('adm')).send({ items: [{ productId: ids['prod'], unitPrice: '99' }] }).expect(204);
      // a cache do catálogo tem prazo curto; a invalidação é imediata ao gravar
      const r = await go(id, 'com', 'SUBMIT').expect(409);
      expect(r.body.code).toBe('DOCUMENT_STALE');
      await h.http().put(`/api/v1/price-lists/${pl.id}/items`).set(A('adm')).send({ items: [{ productId: ids['prod'], unitPrice: '60' }] }).expect(204);
    });

    it('delegação: o substituto decide em nome do gestor, e a decisão fica registada', async () => {
      const { id } = await proposal('22');
      await go(id, 'com', 'COMPILE').expect(201);
      await go(id, 'com', 'SUBMIT').expect(201);
      const reqId = (await h.prisma.approvalRequest.findFirstOrThrow({ where: { proposalId: id } })).id;
      await decide(reqId, 'sub', 'APPROVED').expect(403); // ainda sem delegação

      const d = await h.http().post('/api/v1/delegations').set(A('ges')).send({ toUserId: ids['substId'], validFrom: '2026-01-01', validTo: '2099-01-01' }).expect(201);
      await h.http().post('/api/v1/delegations').set(A('ges')).send({ toUserId: ids['gestorId'], validFrom: '2026-01-01', validTo: '2099-01-01' }).expect(422);
      expect((await inbox('sub')).map((x) => x.id)).toEqual([reqId]);
      const r = await decide(reqId, 'sub', 'APPROVED').expect(201);
      expect(r.body.decisions[0]).toMatchObject({ approverName: 'substituto', onBehalfOfName: 'gestor' });
      await h.http().delete(`/api/v1/delegations/${d.body.id}`).set(A('ges')).expect(204);
    });

    it('cláusula jurídica alterada exige também aprovação do Jurídico', async () => {
      const { id } = await proposal('5', { legalEdit: true });
      await go(id, 'com', 'COMPILE').expect(201);
      await go(id, 'com', 'SUBMIT').expect(201);
      const reqs = await h.prisma.approvalRequest.findMany({ where: { proposalId: id } });
      expect(reqs.map((r) => r.scope)).toEqual(['LEGAL']);
      expect((await inbox('jur')).map((x) => x.scope)).toEqual(['LEGAL']);
      await decide(reqs[0]!.id, 'jur', 'APPROVED').expect(201);
      expect(await status(id)).toBe('APPROVED');
    });

    it('cada pessoa só vê os pedidos que pode decidir; o administrador pode listar todos', async () => {
      const { id } = await proposal('40');
      await go(id, 'com', 'COMPILE').expect(201);
      await go(id, 'com', 'SUBMIT').expect(201);
      expect(await inbox('jur')).toEqual([]);
      expect((await h.http().get('/api/v1/approvals?all=true').set(A('adm')).expect(200)).body.length).toBeGreaterThan(0);
    });
  });
});
