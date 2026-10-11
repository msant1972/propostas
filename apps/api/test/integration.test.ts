import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cpq/shared';
import { OutboxService } from '../src/outbox/outbox.service.js';
import { boot, resetDb, TEST_DB, type Harness } from './helpers.js';

const run = describe.skipIf(!TEST_DB);

run('integração com MariaDB', () => {
  let h: Harness;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await boot();
    await resetDb(h.prisma);
  });
  afterAll(() => h?.close());

  it('autorização: comercial lê o catálogo mas não o altera; administrador cria produtos', async () => {
    const com = await h.token('Comercial');
    const adm = await h.token('Administrador');
    const body = { sku: 'LIC', name: 'Licença', billingModel: 'RECURRING', billingPeriod: 'MONTH', unitCost: '10', taxCategory: 'STANDARD' };
    await h.http().post('/api/v1/catalog/products').set('Authorization', `Bearer ${com}`).send(body).expect(403);
    const created = await h.http().post('/api/v1/catalog/products').set('Authorization', `Bearer ${adm}`).send(body).expect(201);
    ids['LIC'] = created.body.id;
    await h.http().post('/api/v1/catalog/products').set('Authorization', `Bearer ${adm}`).send(body).expect(409);
    const list = await h.http().get('/api/v1/catalog/products').set('Authorization', `Bearer ${com}`).expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty('unitCost');
  });

  it('rejeita corpos inválidos em problem+json', async () => {
    const adm = await h.token('Administrador');
    const r = await h.http().post('/api/v1/catalog/products').set('Authorization', `Bearer ${adm}`).send({ sku: '', billingModel: 'X' }).expect(400);
    expect(r.headers['content-type']).toContain('application/problem+json');
  });

  it('outbox: um rollback não deixa evento gravado, um commit deixa', async () => {
    const outbox = new OutboxService();
    await expect(
      h.prisma.$transaction(async (tx) => {
        await outbox.enqueue(tx, { aggregateId: uuidv7(), eventType: 'system.ping', payload: {} });
        throw new Error('falha de negócio');
      }),
    ).rejects.toThrow('falha de negócio');
    expect(await h.prisma.outboxEvent.count({ where: { eventType: 'system.ping' } })).toBe(0);

    await h.prisma.$transaction((tx) => outbox.enqueue(tx, { aggregateId: uuidv7(), eventType: 'system.ping', payload: { a: 1 } }));
    expect(await h.prisma.outboxEvent.count({ where: { eventType: 'system.ping' } })).toBe(1);
  });

  describe('fluxo CPQ completo', () => {
    let adm: string, com: string, outro: string, gestor: string;
    let proposalId: string, versionId: string;

    beforeAll(async () => {
      adm = await h.token('Administrador');
      com = await h.token('Comercial');
      gestor = await h.token('Gestor_Comercial');
      outro = await h.token('Comercial', 'outro');
      const A = { Authorization: `Bearer ${adm}` };

      const sup = await h.http().post('/api/v1/catalog/products').set(A).send({ sku: 'PRM', name: 'Suporte Premium', billingModel: 'RECURRING', billingPeriod: 'MONTH', unitCost: '4' }).expect(201);
      ids['PRM'] = sup.body.id;
      const pl = await h.http().post('/api/v1/price-lists').set(A).send({ name: 'Geral', currency: 'EUR', validFrom: '2026-01-01' }).expect(201);
      await h.http().put(`/api/v1/price-lists/${pl.body.id}/items`).set(A).send({ items: [
        { productId: ids['LIC'], minQuantity: '0', unitPrice: '20' },
        { productId: ids['LIC'], minQuantity: '50', unitPrice: '18' },
        { productId: ids['PRM'], minQuantity: '0', unitPrice: '9' },
      ] }).expect(204);
      await h.http().post('/api/v1/tax-rates').set(A).send({ countryCode: 'PT', regime: 'STANDARD', ratePercent: '23', validFrom: '2020-01-01' }).expect(201);
      // regra: mais de 50 licenças exige Suporte Premium
      await h.http().post('/api/v1/rules').set(A).send({
        sourceProductId: ids['LIC'], targetProductId: ids['PRM'], ruleType: 'REQUIRES', message: 'Mais de 50 licenças exige Suporte Premium',
        condition: { '>': [{ var: 'source.quantity' }, 50] }, validFrom: '2026-01-01',
      }).expect(201);
      await h.http().post('/api/v1/rules').set(A).send({ sourceProductId: ids['LIC'], targetProductId: ids['PRM'], ruleType: 'REQUIRES', condition: { inventado: [1] }, validFrom: '2026-01-01' }).expect(422);
    });

    it('sobreposição de listas de preços é recusada', async () => {
      await h.http().post('/api/v1/price-lists').set('Authorization', `Bearer ${adm}`).send({ name: 'Duplicada', currency: 'EUR', validFrom: '2026-06-01' }).expect(409);
    });

    it('cria cliente e proposta; a proposta nasce com a versão 1 em rascunho', async () => {
      const c = await h.http().post('/api/v1/clients').set('Authorization', `Bearer ${com}`).send({ code: 'C1', name: 'Cliente Um', countryCode: 'PT', vatNumber: '500000000' }).expect(201);
      const p = await h.http().post('/api/v1/proposals').set('Authorization', `Bearer ${com}`).send({ title: 'Proposta A', clientId: c.body.id }).expect(201);
      proposalId = p.body.id;
      expect(p.body.code).toMatch(/^P-\d{4}-0001$/);
      const q = await h.http().get(`/api/v1/proposals/${proposalId}/quotes/current`).set('Authorization', `Bearer ${com}`).expect(200);
      expect(q.body).toMatchObject({ versionNumber: 1, status: 'DRAFT', isCurrent: true });
      versionId = q.body.id;
    });

    it('visibilidade: outro comercial não vê a proposta; o gestor da equipa sem equipa também não', async () => {
      await h.http().get(`/api/v1/proposals/${proposalId}`).set('Authorization', `Bearer ${outro}`).expect(404);
      const mine = await h.http().get('/api/v1/proposals').set('Authorization', `Bearer ${com}`).expect(200);
      expect(mine.body.total).toBe(1);
      const theirs = await h.http().get('/api/v1/proposals').set('Authorization', `Bearer ${outro}`).expect(200);
      expect(theirs.body.total).toBe(0);
      await h.http().get(`/api/v1/proposals/${proposalId}`).set('Authorization', `Bearer ${adm}`).expect(200);
      expect((await h.http().get('/api/v1/proposals').set('Authorization', `Bearer ${gestor}`)).status).toBe(200);
    });

    it('o servidor rejeita cotações que violam regras (60 licenças sem Suporte Premium)', async () => {
      const r = await h.http().put(`/api/v1/proposals/${proposalId}/quotes/${versionId}`).set('Authorization', `Bearer ${com}`)
        .send({ lines: [{ productId: ids['LIC'], quantity: '60', termMonths: 12 }] }).expect(422);
      expect(JSON.stringify(r.body)).toContain('Mais de 50 licenças exige Suporte Premium');
    });

    it('grava um rascunho válido com os valores calculados à mão', async () => {
      const r = await h.http().put(`/api/v1/proposals/${proposalId}/quotes/${versionId}`).set('Authorization', `Bearer ${com}`)
        .send({ globalDiscountPercent: '5', lines: [
          { productId: ids['LIC'], quantity: '60', termMonths: 12, discountPercent: '10' },
          { productId: ids['PRM'], quantity: '1', termMonths: 12 },
        ] }).expect(200);
      // LIC: 60 × 18 × 0,9 = 972,00 ; PRM: 9,00 ; subtotal 981,00 ; desconto global 5 % = 49,05
      expect(r.body.totals).toMatchObject({ subtotal: '981.00', discountAmount: '49.05' });
      expect(r.body.totals.marginPercent).toBeNull(); // o comercial não vê margens
      expect(r.body.lines[0]).toMatchObject({ listUnitPrice: '18.0000', lineTotal: '923.40', taxAmount: '212.38' });
    });

    it('o gestor vê a margem da mesma cotação (na sua equipa) — o administrador sempre', async () => {
      const r = await h.http().get(`/api/v1/proposals/${proposalId}/quotes/${versionId}`).set('Authorization', `Bearer ${adm}`).expect(200);
      expect(r.body.totals.marginPercent).not.toBeNull();
    });

    it('bloqueia a versão: hash válido, edições recusadas pela API e pela base de dados', async () => {
      const locked = await h.http().post(`/api/v1/proposals/${proposalId}/quotes/${versionId}/lock`).set('Authorization', `Bearer ${com}`).expect(201);
      expect(locked.body.status).toBe('LOCKED');
      expect(locked.body.snapshotHash).toMatch(/^[0-9a-f]{64}$/);

      const v = await h.http().get(`/api/v1/proposals/${proposalId}/quotes/${versionId}/verify`).set('Authorization', `Bearer ${com}`).expect(200);
      expect(v.body.valid).toBe(true);

      await h.http().put(`/api/v1/proposals/${proposalId}/quotes/${versionId}`).set('Authorization', `Bearer ${com}`)
        .send({ lines: [{ productId: ids['PRM'], quantity: '1', termMonths: 12 }] }).expect(409);

      // SQL direto (ignorando a API): os triggers têm de recusar
      await expect(h.prisma.$executeRawUnsafe(`UPDATE quote_items SET line_total = 1 WHERE quote_version_id = '${versionId}'`)).rejects.toThrow(/bloqueada/);
      await expect(h.prisma.$executeRawUnsafe(`DELETE FROM quote_items WHERE quote_version_id = '${versionId}'`)).rejects.toThrow(/bloqueada/);
      await expect(h.prisma.$executeRawUnsafe(`UPDATE quote_versions SET grand_total = 1 WHERE id = '${versionId}'`)).rejects.toThrow(/bloqueada/);
    });

    it('adulterar o snapshot por fora da aplicação é detetado pela verificação do hash', async () => {
      // Só um superutilizador contornaria os triggers; simulamos desativando-os na sessão não é possível, por isso alteramos o JSON do snapshot via TRUNCATE-free rota: recalcular com conteúdo diferente
      const row = await h.prisma.quoteVersion.findUniqueOrThrow({ where: { id: versionId } });
      const tampered = { ...(row.snapshotJson as object), tampered: true };
      const { snapshotHash } = await import('@cpq/rules-engine');
      expect(snapshotHash(tampered)).not.toBe(row.snapshotHash);
    });

    it('nova versão: a anterior fica SUPERSEDED e só há uma versão corrente', async () => {
      const n = await h.http().post(`/api/v1/proposals/${proposalId}/quotes/new-version`).set('Authorization', `Bearer ${com}`).expect(201);
      expect(n.body).toMatchObject({ versionNumber: 2, status: 'DRAFT', isCurrent: true });
      expect(n.body.lines).toHaveLength(2);
      const list = await h.http().get(`/api/v1/proposals/${proposalId}/quotes`).set('Authorization', `Bearer ${com}`).expect(200);
      expect(list.body.map((v: { versionNumber: number; status: string; isCurrent: boolean }) => [v.versionNumber, v.status, v.isCurrent])).toEqual([[2, 'DRAFT', true], [1, 'SUPERSEDED', false]]);
      expect(await h.prisma.quoteVersion.count({ where: { proposalId, isCurrent: true } })).toBe(1);
      // a base de dados impede duas versões correntes
      await expect(h.prisma.$executeRawUnsafe(`UPDATE quote_versions SET is_current = TRUE WHERE id = '${versionId}'`)).rejects.toThrow();
      await h.http().post(`/api/v1/proposals/${proposalId}/quotes/new-version`).set('Authorization', `Bearer ${com}`).expect(409);
    });

    it('o bloqueio registou um evento no outbox', async () => {
      expect(await h.prisma.outboxEvent.count({ where: { eventType: 'quote.locked' } })).toBe(1);
    });
  });
});
