import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDocumentRepository, compileProposal } from '@cpq/documents';
import { boot, resetDb, TEST_DB, type Harness } from './helpers.js';

const run = describe.skipIf(!TEST_DB);

run('portal do cliente, integração com o CRM e RGPD', () => {
  let h: Harness;
  let repo: LocalDocumentRepository;
  const tk: Record<string, string> = {};
  const A = (r: string) => ({ Authorization: `Bearer ${tk[r]}` });
  const ids: Record<string, string> = {};

  /** Proposta aprovada e enviada (sem políticas aplicáveis), pronta para o portal. */
  async function sentProposal(validUntil = '2099-12-31'): Promise<string> {
    const c = await h.http().post('/api/v1/proposals').set(A('com')).send({ title: 'Proposta portal', clientId: ids['client'], validUntil }).expect(201);
    const id = c.body.id as string;
    const q = (await h.http().get(`/api/v1/proposals/${id}/quotes/current`).set(A('com'))).body;
    await h.http().put(`/api/v1/proposals/${id}/quotes/${q.id}`).set(A('com')).send({ lines: [{ productId: ids['prod'], quantity: '10' }] }).expect(200);
    await h.http().post(`/api/v1/proposals/${id}/sections`).set(A('com')).send({ title: 'Texto' }).expect(201);
    const s = (await h.http().get(`/api/v1/proposals/${id}/sections`).set(A('com'))).body[0];
    await h.http().put(`/api/v1/proposals/${id}/sections/${s.id}`).set(A('com')).send({ rowVersion: s.rowVersion, html: '<p>Para {{cliente.nome}}.</p><p>{{tabela_precos}}</p>' }).expect(200);
    await compileProposal(h.prisma, repo, { proposalId: id, requestedBy: null });
    for (const event of ['COMPILE', 'SUBMIT', 'SEND']) await h.http().post(`/api/v1/proposals/${id}/transitions`).set(A('com')).send({ event }).expect(201);
    return id;
  }
  const tokenOf = (url: string) => url.split('/portal/')[1]!;
  const view = (token: string) => h.http().get(`/api/v1/portal/${token}`);
  const respond = (token: string, body: object) => h.http().post(`/api/v1/portal/${token}/response`).set('User-Agent', 'TesteBrowser/1.0').send(body);
  const accept = { decision: 'ACCEPTED', signerName: 'Rui Silva', signerEmail: 'Rui.Silva@cliente.pt', confirmRead: true };

  beforeAll(async () => {
    process.env['DOCUMENT_STORAGE_DIR'] = await mkdtemp(join(tmpdir(), 'portal-docs-'));
    h = await boot();
    await resetDb(h.prisma);
    repo = new LocalDocumentRepository(process.env['DOCUMENT_STORAGE_DIR']!);
    tk['com'] = await h.token('Comercial', 'dono');
    tk['outro'] = await h.token('Comercial', 'outro');
    tk['adm'] = await h.token('Administrador', 'adm');
    const p = await h.http().post('/api/v1/catalog/products').set(A('adm')).send({ sku: 'IMP', name: 'Implementação', billingModel: 'ONE_TIME', unitCost: '40' }).expect(201);
    ids['prod'] = p.body.id;
    const pl = await h.http().post('/api/v1/price-lists').set(A('adm')).send({ name: 'Geral', currency: 'EUR', validFrom: '2026-01-01' }).expect(201);
    await h.http().put(`/api/v1/price-lists/${pl.body.id}/items`).set(A('adm')).send({ items: [{ productId: p.body.id, unitPrice: '60' }] }).expect(204);
    await h.http().post('/api/v1/tax-rates').set(A('adm')).send({ countryCode: 'PT', regime: 'STANDARD', ratePercent: '23', validFrom: '2020-01-01' }).expect(201);
    const c = await h.http().post('/api/v1/clients').set(A('com')).send({ code: 'C-PORTAL', name: 'Cliente Portal', countryCode: 'PT', vatNumber: '500000003', contactName: 'Rui Silva', contactEmail: 'rui.silva@cliente.pt' }).expect(201);
    ids['client'] = c.body.id;
  });
  afterAll(() => h?.close());

  describe('ligações do portal', () => {
    let id: string;

    it('só se cria ligação depois de enviar; o token só aparece na criação', async () => {
      const draft = await h.http().post('/api/v1/proposals').set(A('com')).send({ title: 'x', clientId: ids['client'] }).expect(201);
      await h.http().post(`/api/v1/proposals/${draft.body.id}/share-links`).set(A('com')).send({}).expect(409);

      id = await sentProposal();
      await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('outro')).send({}).expect(404); // outro comercial nem vê a proposta
      const r = await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('com')).send({}).expect(201);
      expect(r.body.url).toMatch(/\/portal\/[A-Za-z0-9_-]{43}$/);
      const row = await h.prisma.shareLink.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(tokenOf(r.body.url)); // só o hash fica guardado
      ids['link'] = r.body.id;
      ids['token'] = tokenOf(r.body.url);
    });

    it('o cliente vê a proposta sem conta; a abertura fica contada e auditada uma vez', async () => {
      const v = await view(ids['token']!).expect(200);
      expect(v.body).toMatchObject({ proposalCode: expect.stringMatching(/^P-/), clientName: 'Cliente Portal', state: 'OPEN', grandTotal: '738.00', currency: 'EUR' });
      await view(ids['token']!).expect(200);
      const link = await h.prisma.shareLink.findUniqueOrThrow({ where: { id: ids['link']! } });
      expect(link.openCount).toBe(2);
      expect(link.firstOpenedAt).not.toBeNull();
      const opened = await h.prisma.outboxEvent.findMany({ where: { eventType: 'audit.record', aggregateId: id } });
      expect(opened.filter((e) => (e.payload as { action: string }).action === 'portal.opened')).toHaveLength(1);
    });

    it('o PDF mostra-se ao cliente e é exatamente o aprovado', async () => {
      const r = await h.http().get(`/api/v1/portal/${ids['token']}/document`).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      }).expect(200);
      expect(r.headers['content-type']).toBe('application/pdf');
      expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('tokens inventados, malformados ou de ligações revogadas dão a mesma resposta', async () => {
      const a = await view('x'.repeat(43)).expect(404);
      const b = await view('curto').expect(404);
      expect(a.body.detail).toBe(b.body.detail);
      const nova = await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('com')).send({}).expect(201); // revoga a anterior
      await view(ids['token']!).expect(404);
      ids['token'] = tokenOf(nova.body.url);
      ids['link'] = nova.body.id;
      const list = (await h.http().get(`/api/v1/proposals/${id}/share-links`).set(A('com')).expect(200)).body as Array<{ status: string }>;
      expect(list.map((l) => l.status)).toEqual(['ACTIVE', 'REVOKED']);
    });

    it('a ligação por email deixa o token no evento só até ser enviado', async () => {
      const r = await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('com')).send({ sendTo: 'rui.silva@cliente.pt' }).expect(201);
      expect(r.body.sentTo).toBe('rui.silva@cliente.pt');
      const ev = await h.prisma.outboxEvent.findFirstOrThrow({ where: { eventType: 'portal.invite' } });
      expect((ev.payload as { token: string }).token).toBe(tokenOf(r.body.url));
      ids['token'] = tokenOf(r.body.url);
      ids['link'] = r.body.id;
    });
  });

  describe('resposta do cliente', () => {
    it('aceitar exige a confirmação de leitura e um nome e email válidos', async () => {
      await respond(ids['token']!, { ...accept, confirmRead: false }).expect(422);
      await respond(ids['token']!, { ...accept, signerEmail: 'isto-nao-e-email' }).expect(400);
      await respond(ids['token']!, { ...accept, signerName: 'R' }).expect(400);
      await respond(ids['token']!, { ...accept, decision: 'TALVEZ' }).expect(400);
    });

    it('aceitar regista a prova, passa a proposta a ACEITE e pede o comprovativo', async () => {
      const r = await respond(ids['token']!, accept).expect(201);
      expect(r.body).toMatchObject({ state: 'ACCEPTED', response: { decision: 'ACCEPTED', signerName: 'Rui Silva', signerEmail: 'rui.silva@cliente.pt' } });

      const resp = await h.prisma.customerResponse.findFirstOrThrow({ where: { shareLinkId: ids['link']! } });
      const doc = await h.prisma.document.findFirstOrThrow({ where: { proposalId: resp.proposalId, kind: 'PDF', folder: 'F02_ENVIADO' } });
      expect(resp).toMatchObject({ decision: 'ACCEPTED', documentSha256: doc.sha256, userAgent: 'TesteBrowser/1.0' });
      expect(resp.ipAddress).toBeTruthy();
      expect((await h.prisma.proposal.findUniqueOrThrow({ where: { id: resp.proposalId } })).status).toBe('ACCEPTED');

      const events = (await h.prisma.outboxEvent.findMany({ where: { aggregateId: resp.proposalId } })).map((e) => e.eventType);
      expect(events).toEqual(expect.arrayContaining(['portal.receipt', 'proposal.accepted']));
      // a auditoria imutável não guarda o nome nem o email do signatário
      const audit = await h.prisma.outboxEvent.findMany({ where: { eventType: 'audit.record', aggregateId: resp.proposalId } });
      expect(JSON.stringify(audit.map((a) => a.payload))).not.toContain('Rui');
      expect(JSON.stringify(audit.map((a) => a.payload))).not.toContain('cliente.pt');
    });

    it('só se responde uma vez; depois a ligação só mostra o resultado', async () => {
      await respond(ids['token']!, accept).expect(409);
      const v = await view(ids['token']!).expect(200);
      expect(v.body.state).toBe('ACCEPTED');
      const list = (await h.http().get(`/api/v1/proposals/${v.body.proposalCode ? (await h.prisma.proposal.findFirstOrThrow({ where: { code: v.body.proposalCode } })).id : ''}/share-links`).set(A('com'))).body as Array<{ status: string }>;
      expect(list[0]!.status).toBe('RESPONDED');
    });

    it('recusar com motivo passa a REJEITADA', async () => {
      const id = await sentProposal();
      const link = await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('com')).send({}).expect(201);
      const r = await respond(tokenOf(link.body.url), { decision: 'DECLINED', signerName: 'Ana Costa', signerEmail: 'ana@cliente.pt', comment: 'Fora do orçamento', confirmRead: false }).expect(201);
      expect(r.body.state).toBe('DECLINED');
      expect(await h.prisma.proposal.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'REJECTED', statusReason: 'Fora do orçamento' });
    });

    it('uma proposta que já não está enviada não aceita resposta; ligações expiradas dão 404', async () => {
      const id = await sentProposal();
      const link = await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('com')).send({}).expect(201);
      await h.http().post(`/api/v1/proposals/${id}/transitions`).set(A('com')).send({ event: 'CANCEL', reason: 'Desistência' }).expect(201);
      await respond(tokenOf(link.body.url), accept).expect(409);

      const id2 = await sentProposal();
      const l2 = await h.http().post(`/api/v1/proposals/${id2}/share-links`).set(A('com')).send({}).expect(201);
      await h.prisma.shareLink.update({ where: { id: l2.body.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await view(tokenOf(l2.body.url)).expect(404);
      await respond(tokenOf(l2.body.url), accept).expect(404);
    });

    it('a ligação não passa da validade da proposta e propostas expiradas não a criam', async () => {
      const id = await sentProposal(new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10));
      const l = await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('com')).send({}).expect(201);
      expect(new Date(l.body.expiresAt).getTime()).toBeLessThan(Date.now() + 3 * 864e5);
    });

    it('o ficheiro alterado em disco não é mostrado nem aceite', async () => {
      const id = await sentProposal();
      const l = await h.http().post(`/api/v1/proposals/${id}/share-links`).set(A('com')).send({}).expect(201);
      const doc = await h.prisma.document.findFirstOrThrow({ where: { proposalId: id, kind: 'PDF', folder: 'F02_ENVIADO' } });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(repo.fullPath(doc.storageKey), Buffer.from('adulterado'));
      await h.http().get(`/api/v1/portal/${tokenOf(l.body.url)}/document`).expect(409);
      await respond(tokenOf(l.body.url), accept).expect(409);
      expect((await h.prisma.proposal.findUniqueOrThrow({ where: { id } })).status).toBe('SENT');
    });
  });

  describe('integração com o CRM', () => {
    let key: string;

    it('só o administrador gere chaves; a chave completa só aparece na criação', async () => {
      await h.http().post('/api/v1/api-keys').set(A('com')).send({ name: 'CRM', scopes: ['clients:write'] }).expect(403);
      await h.http().post('/api/v1/api-keys').set(A('adm')).send({ name: 'CRM', scopes: ['inventado'] }).expect(400);
      const r = await h.http().post('/api/v1/api-keys').set(A('adm')).send({ name: 'CRM', scopes: ['clients:write', 'proposals:read'] }).expect(201);
      key = r.body.key as string;
      ids['keyId'] = r.body.id;
      expect(key).toMatch(/^cpq_/);
      const list = (await h.http().get('/api/v1/api-keys').set(A('adm')).expect(200)).body;
      expect(JSON.stringify(list)).not.toContain(key);
      expect(list[0].prefix).toBe(key.slice(0, 8));
    });

    it('sem chave, com chave inválida ou sem o âmbito certo não entra', async () => {
      await h.http().post('/api/v1/integrations/crm/clients').send({ clients: [] }).expect(401);
      await h.http().post('/api/v1/integrations/crm/clients').set('X-Api-Key', 'cpq_inventada_inventada_inventada').send({ clients: [] }).expect(401);
      const only = await h.http().post('/api/v1/api-keys').set(A('adm')).send({ name: 'Leitura', scopes: ['proposals:read'] }).expect(201);
      await h.http().post('/api/v1/integrations/crm/clients').set('X-Api-Key', only.body.key).send({ clients: [] }).expect(403);
      // um token de utilizador não substitui a chave
      await h.http().post('/api/v1/integrations/crm/clients').set(A('adm')).send({ clients: [] }).expect(401);
    });

    it('sincroniza clientes: cria, atualiza, liga por código, elimina e reporta conflitos', async () => {
      const sync = (clients: object[]) => h.http().post('/api/v1/integrations/crm/clients').set('X-Api-Key', key).send({ clients });
      const first = await sync([
        { externalId: 'CRM-1', name: 'Alfa, Lda.', countryCode: 'PT', vatNumber: '501', contactEmail: 'Alfa@alfa.pt' },
        { externalId: 'CRM-2', code: 'BETA', name: 'Beta SA', countryCode: 'ES', tier: 'gold' },
        { externalId: 'CRM-3', code: 'C-PORTAL', name: 'Cliente Portal (CRM)', countryCode: 'PT' }, // liga ao cliente existente
      ]).expect(201);
      expect(first.body).toMatchObject({ created: 2, updated: 1, deleted: 0, errors: [] });
      expect(await h.prisma.client.findUniqueOrThrow({ where: { crmExternalId: 'CRM-1' } })).toMatchObject({ code: 'CRM-CRM-1', contactEmail: 'alfa@alfa.pt' });
      expect(await h.prisma.client.findUniqueOrThrow({ where: { crmExternalId: 'CRM-3' } })).toMatchObject({ id: ids['client'], name: 'Cliente Portal (CRM)' });

      const second = await sync([
        { externalId: 'CRM-1', name: 'Alfa Renovada, Lda.', countryCode: 'PT' },
        { externalId: 'CRM-2', name: 'Beta SA', countryCode: 'ES', deleted: true },
        { externalId: 'CRM-9', code: 'BETA', name: 'Outro com código repetido', countryCode: 'PT' },
        { externalId: 'CRM-10', name: 'Nome', countryCode: 'PT', deleted: true },
      ]).expect(201);
      expect(second.body).toMatchObject({ created: 0, updated: 1, deleted: 1 });
      expect(second.body.errors).toMatchObject([{ index: 2, externalId: 'CRM-9', code: 'CODE_CONFLICT' }]);
      expect((await h.prisma.client.findUniqueOrThrow({ where: { crmExternalId: 'CRM-2' } })).deletedAt).not.toBeNull();
      await sync([{ externalId: 'X', name: '', countryCode: 'portugal' }]).expect(400);
    });

    it('o CRM lê as propostas alteradas por páginas', async () => {
      const feed = (q = '') => h.http().get(`/api/v1/integrations/crm/proposals${q}`).set('X-Api-Key', key);
      const all = (await feed('?pageSize=500').expect(200)).body;
      expect(all.items.length).toBeGreaterThan(3);
      expect(all.items[0]).toMatchObject({ clientExternalId: expect.anything(), currency: 'EUR' });
      const page = (await feed('?pageSize=2').expect(200)).body;
      expect(page.items).toHaveLength(2);
      expect(page.nextSince).toBeTruthy();
      const rest = (await feed(`?pageSize=500&since=${encodeURIComponent(page.nextSince)}`).expect(200)).body;
      expect(rest.items.every((i: { updatedAt: string }) => i.updatedAt > page.nextSince)).toBe(true);
      expect((await feed('?since=ontem').expect(200)).body.items).toEqual([]);
    });

    it('revogar a chave corta o acesso de imediato', async () => {
      await h.http().delete(`/api/v1/api-keys/${ids['keyId']}`).set(A('adm')).expect(204);
      await h.http().get('/api/v1/integrations/crm/proposals').set('X-Api-Key', key).expect(401);
    });
  });

  describe('RGPD', () => {
    it('só o administrador exporta e anonimiza', async () => {
      await h.http().post('/api/v1/privacy/export').set(A('com')).send({ email: 'rui.silva@cliente.pt' }).expect(403);
      await h.http().post('/api/v1/privacy/anonymize').set(A('com')).send({ email: 'rui.silva@cliente.pt', confirm: true }).expect(403);
    });

    it('exporta tudo o que há sobre um titular, sem segredos', async () => {
      const r = await h.http().post('/api/v1/privacy/export').set(A('adm')).send({ email: 'Rui.Silva@Cliente.pt' }).expect(201);
      expect(r.body.clients).toHaveLength(1);
      expect(r.body.customerResponses.length).toBeGreaterThanOrEqual(1);
      expect(r.body.customerResponses[0]).toMatchObject({ signerName: 'Rui Silva', decision: 'ACCEPTED' });
      expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|scrypt/);
    });

    it('anonimizar exige confirmação, apaga os dados pessoais e mantém a prova (decisão e hash)', async () => {
      await h.http().post('/api/v1/privacy/anonymize').set(A('adm')).send({ email: 'rui.silva@cliente.pt', confirm: false }).expect(422);
      const r = await h.http().post('/api/v1/privacy/anonymize').set(A('adm')).send({ email: 'rui.silva@cliente.pt', confirm: true }).expect(201);
      expect(r.body.customerResponses).toBeGreaterThanOrEqual(1);
      expect(r.body.clients).toBe(1);

      const resp = await h.prisma.customerResponse.findMany({ where: { signerName: 'Anonimizado' } });
      expect(resp.length).toBeGreaterThanOrEqual(1);
      expect(resp[0]).toMatchObject({ decision: 'ACCEPTED', signerEmail: expect.stringMatching(/@invalid$/), ipAddress: null, userAgent: null });
      expect(resp[0]!.documentSha256).toMatch(/^[0-9a-f]{64}$/); // a prova mantém-se
      expect(await h.prisma.client.count({ where: { contactEmail: 'rui.silva@cliente.pt' } })).toBe(0);
      expect((await h.http().post('/api/v1/privacy/export').set(A('adm')).send({ email: 'rui.silva@cliente.pt' })).body.customerResponses).toEqual([]);
    });

    it('anonimiza também utilizadores internos (e termina-lhes a sessão), mas nunca o próprio', async () => {
      const u = await h.makeUser({ role: 'Comercial', key: 'sair' });
      const t = await h.login(u.email);
      await h.http().post('/api/v1/privacy/anonymize').set(A('adm')).send({ email: u.email, confirm: true }).expect(201);
      await h.http().get('/api/v1/me').set({ Authorization: `Bearer ${t}` }).expect(401);
      const row = await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } });
      expect(row).toMatchObject({ displayName: 'Utilizador removido', isActive: false, passwordHash: null });
      const me = (await h.http().get('/api/v1/me').set(A('adm'))).body.email as string;
      await h.http().post('/api/v1/privacy/anonymize').set(A('adm')).send({ email: me, confirm: true }).expect(422);
    });
  });
});
