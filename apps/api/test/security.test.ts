import 'reflect-metadata';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalDocumentRepository, compileProposal } from '@cpq/documents';
import { uuidv7 } from '@cpq/shared';
import { IS_PUBLIC } from '../src/auth/public.decorator.js';
import { buildOpenApi } from '../src/setup.js';
import { withoutMargin } from '../src/workflow/workflow.service.js';
import { boot, resetDb, TEST_DB, type Harness } from './helpers.js';

const run = describe.skipIf(!TEST_DB);

/** Rotas públicas permitidas (método + caminho). Qualquer outra rota @Public() faz o teste falhar. */
const PUBLIC_ROUTES = new Set([
  'GET /health',
  'POST /auth/login',
  'GET /portal/:token',
  'GET /portal/:token/document',
  'POST /portal/:token/response',
]);
/** Rotas autenticadas sem @CheckAbility, por desenho (qualquer utilizador autenticado, sobre si próprio). */
const NO_ABILITY_OK = new Map([
  ['GET /me', 'devolve só o próprio utilizador'],
  ['POST /auth/change-password', 'só altera a palavra-passe do próprio utilizador'],
]);

interface Route { method: string; path: string; isPublic: boolean; ability: unknown; apiKeyScope: unknown }

/** Percorre os controladores registados e lê os metadados de cada rota (método HTTP, caminho, @Public, @CheckAbility, @ApiKeyScope). */
function collectRoutes(h: Harness): Route[] {
  const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
  const out: Route[] = [];
  const join2 = (...p: string[]) => '/' + p.flatMap((x) => x.split('/')).filter(Boolean).join('/');
  for (const mod of h.app.get(ModulesContainer).values()) {
    for (const wrapper of mod.controllers.values()) {
      const cls = wrapper.metatype as (new (...a: never[]) => unknown) | null;
      if (!cls) continue;
      const base = (Reflect.getMetadata('path', cls) as string | string[] | undefined) ?? '';
      const proto = cls.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const fn = proto[name];
        if (name === 'constructor' || typeof fn !== 'function') continue;
        const m = Reflect.getMetadata('method', fn) as number | undefined;
        if (m === undefined) continue;
        const sub = (Reflect.getMetadata('path', fn) as string | string[]) ?? '';
        out.push({
          method: METHODS[m] ?? String(m),
          path: join2(Array.isArray(base) ? base[0]! : base, Array.isArray(sub) ? sub[0]! : sub),
          isPublic: Boolean(Reflect.getMetadata(IS_PUBLIC, fn) ?? Reflect.getMetadata(IS_PUBLIC, cls)),
          ability: Reflect.getMetadata('checkAbility', fn) ?? Reflect.getMetadata('checkAbility', cls),
          apiKeyScope: Reflect.getMetadata('apiKeyScope', fn) ?? Reflect.getMetadata('apiKeyScope', cls),
        });
      }
    }
  }
  return out;
}

run('segurança: cobertura de rotas e testes de abuso', () => {
  let h: Harness;
  let repo: LocalDocumentRepository;
  const tk: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const A = (r: string) => ({ Authorization: `Bearer ${tk[r]}` });
  const TEAM_A = uuidv7();
  const TEAM_B = uuidv7();

  async function proposalOf(who: string, title = 'Proposta segurança'): Promise<string> {
    const c = await h.http().post('/api/v1/proposals').set(A(who)).send({ title, clientId: ids['client'] }).expect(201);
    return c.body.id as string;
  }

  beforeAll(async () => {
    process.env['DOCUMENT_STORAGE_DIR'] = await mkdtemp(join(tmpdir(), 'sec-docs-'));
    h = await boot();
    await resetDb(h.prisma);
    repo = new LocalDocumentRepository(process.env['DOCUMENT_STORAGE_DIR']!);
    await h.prisma.team.createMany({ data: [{ id: TEAM_A, name: 'A' }, { id: TEAM_B, name: 'B' }] });
    const u = {
      com: await h.makeUser({ role: 'Comercial', key: 'dono', name: 'dono', teamId: TEAM_A }),
      outro: await h.makeUser({ role: 'Comercial', key: 'outro', name: 'outro', teamId: TEAM_B }),
      gesA: await h.makeUser({ role: 'Gestor_Comercial', key: 'gesa', name: 'gesA', teamId: TEAM_A }),
      gesB: await h.makeUser({ role: 'Gestor_Comercial', key: 'gesb', name: 'gesB', teamId: TEAM_B }),
      gesSem: await h.makeUser({ role: 'Gestor_Comercial', key: 'gessem', name: 'gesSem' }),
      adm: await h.makeUser({ role: 'Administrador', key: 'adm', name: 'admin' }),
    };
    for (const k of Object.keys(u) as Array<keyof typeof u>) tk[k] = await h.login(u[k].email);
    ids['outroId'] = u.outro.id;
    const p = await h.http().post('/api/v1/catalog/products').set(A('adm')).send({ sku: 'SEC', name: 'Serviço', billingModel: 'ONE_TIME', unitCost: '40' }).expect(201);
    ids['prod'] = p.body.id;
    const pl = await h.http().post('/api/v1/price-lists').set(A('adm')).send({ name: 'Geral', currency: 'EUR', validFrom: '2026-01-01' }).expect(201);
    await h.http().put(`/api/v1/price-lists/${pl.body.id}/items`).set(A('adm')).send({ items: [{ productId: p.body.id, unitPrice: '60' }] }).expect(204);
    await h.http().post('/api/v1/tax-rates').set(A('adm')).send({ countryCode: 'PT', regime: 'STANDARD', ratePercent: '23', validFrom: '2020-01-01' }).expect(201);
    const c = await h.http().post('/api/v1/clients').set(A('com')).send({ code: 'C-SEC', name: 'Cliente Sec', countryCode: 'PT', vatNumber: '500000004' }).expect(201);
    ids['client'] = c.body.id;
    ids['prop'] = await proposalOf('com');
  });
  afterAll(() => h?.close());

  // -- cobertura de rotas -------------------------------------------------------------------------
  describe('todas as rotas têm controlo de acesso explícito', () => {
    it('a lista de rotas coincide com a do OpenAPI (nenhuma rota escapa ao teste)', () => {
      const routes = collectRoutes(h);
      const doc = buildOpenApi(h.app);
      const openapi = Object.entries(doc.paths).flatMap(([path, item]) =>
        Object.keys(item as object).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => `${m.toUpperCase()} ${path.replace(/^\/api\/v1/, '').replace(/\{(\w+)\}/g, ':$1')}`),
      );
      const found = routes.map((r) => `${r.method} ${r.path}`);
      expect(routes.length).toBeGreaterThan(60);
      expect([...new Set(found)].sort()).toEqual([...new Set(openapi)].sort());
    });

    it('cada rota é pública (lista fechada), usa chave de API com âmbito, ou tem @CheckAbility', () => {
      const offenders: string[] = [];
      for (const r of collectRoutes(h)) {
        const key = `${r.method} ${r.path}`;
        if (r.isPublic) {
          if (!PUBLIC_ROUTES.has(key) && !r.apiKeyScope) offenders.push(`${key}: pública sem estar na lista`);
        } else if (!r.ability && !NO_ABILITY_OK.has(key)) {
          offenders.push(`${key}: autenticada sem @CheckAbility`);
        }
      }
      expect(offenders).toEqual([]);
    });

    it('as rotas da lista de exceções e as públicas existem (a lista não apodrece)', () => {
      const keys = new Set(collectRoutes(h).map((r) => `${r.method} ${r.path}`));
      for (const k of [...PUBLIC_ROUTES, ...NO_ABILITY_OK.keys()]) expect(keys.has(k), k).toBe(true);
    });

    it('sem token, toda a rota não pública responde 401 (e a de chave de API também)', async () => {
      const uuid = uuidv7();
      for (const r of collectRoutes(h).filter((x) => !PUBLIC_ROUTES.has(`${x.method} ${x.path}`))) {
        const url = '/api/v1' + r.path.replace(/:\w+/g, uuid);
        const res = await h.http()[r.method.toLowerCase() as 'get'](url).send({});
        expect(res.status, `${r.method} ${url}`).toBe(401);
      }
    });

    it('um Comercial não obtém 2xx em rotas de administração nem em recursos de outra equipa', async () => {
      const uuid = uuidv7();
      for (const r of collectRoutes(h)) {
        if (r.isPublic || !r.ability) continue;
        const [action, subject] = r.ability as [string, string];
        const adminOnly = ['User', 'Rule', 'AuditLog', 'all'].includes(subject) || (subject === 'Product' && action !== 'read') || (['PriceList', 'TaxRate', 'FxRate'].includes(subject) && action !== 'read');
        const proposalScoped = r.path.startsWith('/proposals/:id');
        if (!adminOnly && !proposalScoped) continue;
        // `outro` não é dono de `prop` nem gestor: todos os recursos da proposta têm de dar 403/404 (ou 4xx de validação), nunca 2xx.
        const url = '/api/v1' + r.path.replace(':id', ids['prop']!).replace(/:\w+/g, uuid);
        const res = await h.http()[r.method.toLowerCase() as 'get'](url).set(A('outro')).send({});
        if (adminOnly && !proposalScoped && r.path !== '/teams') expect(res.status, `${r.method} ${url}`).toBe(403);
        else expect(res.status, `${r.method} ${url}`).toBeGreaterThanOrEqual(400);
      }
    });
  });

  // -- IDOR ---------------------------------------------------------------------------------------
  describe('acesso a objetos de outros utilizadores', () => {
    it('proposta, cotações, secções, documentos e histórico de outra equipa dão 404', async () => {
      const base = `/api/v1/proposals/${ids['prop']}`;
      for (const p of ['', '/quotes', '/quotes/current', '/sections', '/documents', '/timeline', '/transitions', '/share-links']) {
        await h.http().get(base + p).set(A('outro')).expect(404);
        await h.http().get(base + p).set(A('gesB')).expect(404); // gestor de outra equipa
      }
      await h.http().patch(base).set(A('outro')).send({ title: 'x' }).expect(404);
      await h.http().get(base).set(A('gesA')).expect(200); // o gestor da equipa vê
      const list = await h.http().get('/api/v1/proposals').set(A('outro')).expect(200);
      expect(list.body.items).toEqual([]);
    });

    it('o dono não pode transferir a proposta nem alterar o dono por PATCH (campos extra recusados)', async () => {
      await h.http().patch(`/api/v1/proposals/${ids['prop']}`).set(A('com')).send({ ownerUserId: ids['outroId'] }).expect(400);
    });

    it('um token de utilizador desativado deixa de valer logo (sessão revogada)', async () => {
      const victim = await h.makeUser({ role: 'Comercial', key: 'vitima' });
      const t = await h.login(victim.email);
      await h.http().get('/api/v1/me').set({ Authorization: `Bearer ${t}` }).expect(200);
      await h.http().patch(`/api/v1/users/${victim.id}`).set(A('adm')).send({ isActive: false }).expect(200);
      await h.http().get('/api/v1/me').set({ Authorization: `Bearer ${t}` }).expect(401);
      await h.http().post('/api/v1/auth/login').send({ email: victim.email, password: 'Teste-Pass-2026!' }).expect(401);
    });

    it('tokens forjados são recusados: alg none, assinatura errada, sem o campo de versão', async () => {
      const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const payload = { sub: ids['outroId'], iss: 'cpq', tv: 0, exp: Math.floor(Date.now() / 1000) + 600 };
      for (const t of [`${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`, `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.assinatura-falsa`, 'lixo', '']) {
        await h.http().get('/api/v1/me').set({ Authorization: `Bearer ${t}` }).expect(401);
      }
    });

    it('o mesmo erro para email inexistente e palavra-passe errada (sem enumeração)', async () => {
      const u = await h.makeUser({ role: 'Comercial', key: 'enum' });
      const a = await h.http().post('/api/v1/auth/login').send({ email: u.email, password: 'errada-errada-1' }).expect(401);
      const b = await h.http().post('/api/v1/auth/login').send({ email: 'nao.existe@teste.pt', password: 'errada-errada-1' }).expect(401);
      expect(a.body.detail).toBe(b.body.detail);
    });
  });

  // -- aprovações ---------------------------------------------------------------------------------
  describe('aprovações: objeto, equipa e margens', () => {
    let reqId: string;
    let id: string;

    it('prepara um pedido de aprovação aberto', async () => {
      await h.http().post('/api/v1/approval-policies').set(A('adm')).send({
        name: 'Sempre', scope: 'COMMERCIAL', mode: 'SEQUENTIAL', validFrom: '2026-01-01', levels: [{ level: 1, role: 'Gestor_Comercial', slaHours: 24 }],
      }).expect(201);
      id = await proposalOf('com', 'Para aprovar');
      const q = (await h.http().get(`/api/v1/proposals/${id}/quotes/current`).set(A('com'))).body;
      await h.http().put(`/api/v1/proposals/${id}/quotes/${q.id}`).set(A('com')).send({ lines: [{ productId: ids['prod'], quantity: '10' }] }).expect(200);
      await h.http().post(`/api/v1/proposals/${id}/sections`).set(A('com')).send({ title: 'Texto' }).expect(201);
      const s = (await h.http().get(`/api/v1/proposals/${id}/sections`).set(A('com'))).body[0];
      await h.http().put(`/api/v1/proposals/${id}/sections/${s.id}`).set(A('com')).send({ rowVersion: s.rowVersion, html: '<p>Para {{cliente.nome}}.</p>' }).expect(200);
      await compileProposal(h.prisma, repo, { proposalId: id, requestedBy: null });
      for (const event of ['COMPILE', 'SUBMIT']) await h.http().post(`/api/v1/proposals/${id}/transitions`).set(A('com')).send({ event }).expect(201);
      reqId = (await h.prisma.approvalRequest.findFirstOrThrow({ where: { proposalId: id } })).id;
    });

    it('gestor de outra equipa não vê o detalhe do pedido nem o decide; o da equipa vê', async () => {
      await h.http().get(`/api/v1/approvals/${reqId}`).set(A('gesB')).expect(404);
      await h.http().post(`/api/v1/approvals/${reqId}/decision`).set(A('gesB')).send({ decision: 'APPROVED' }).expect(403);
      await h.http().get(`/api/v1/approvals/${reqId}`).set(A('gesA')).expect(200);
      await h.http().get(`/api/v1/approvals/${reqId}`).set(A('com')).expect(200); // o dono
    });

    it('gestor sem equipa não aprova pedidos comerciais de uma equipa', async () => {
      await h.http().post(`/api/v1/approvals/${reqId}/decision`).set(A('gesSem')).send({ decision: 'APPROVED' }).expect(403);
    });

    it('a margem não aparece no histórico de quem não vê custos', async () => {
      const t = await h.http().get(`/api/v1/proposals/${id}/timeline`).set(A('com')).expect(200);
      expect(JSON.stringify(t.body)).not.toContain('margin_percent');
      // a auditoria chega à tabela pelo worker; a função de máscara testa-se diretamente
      const detail = { vars: { margin_percent: 12, grand_total: 5 }, policy: 'x' };
      expect(withoutMargin(detail)).toEqual({ vars: { grand_total: 5 }, policy: 'x' });
      expect(withoutMargin({ a: 1 })).toEqual({ a: 1 });
    });
  });

  // -- uploads, XSS, JSONLogic --------------------------------------------------------------------
  describe('documentos carregados', () => {
    const up = (who: string | null, q: string, body: Buffer) => {
      const r = h.http().post(`/api/v1/proposals/${ids['prop']}/documents/upload${q}`).set('Content-Type', 'application/octet-stream');
      return (who ? r.set(A(who)) : r).send(body);
    };

    it('o nome do ficheiro é sempre gerado pelo servidor (sem path traversal)', async () => {
      const r = await up('com', '?kind=PDF&fileName=../../../etc/passwd', Buffer.from('%PDF-1.4\n%teste')).expect(201);
      expect(r.body.fileName).toMatch(/^P-\d{4}-\d{4}_editado_\d{8}T\d{6}Z_\w{6}\.pdf$/);
      const row = await h.prisma.document.findUniqueOrThrow({ where: { id: r.body.id } });
      expect(row.storageKey).not.toContain('..');
      expect(row.storageKey.startsWith('Clientes/')).toBe(true);
    });

    it('recusa tipos que não correspondem (magic bytes), vazio, kind inválido, anónimo e dono errado', async () => {
      await up('com', '?kind=PDF', Buffer.from('<html><script>alert(1)</script>')).expect(422);
      await up('com', '?kind=DOCX', Buffer.from('%PDF-1.4')).expect(422);
      await up('com', '?kind=EXE', Buffer.from('MZ')).expect(400);
      await up('outro', '?kind=PDF', Buffer.from('%PDF-1.4')).expect(404);
      await up(null, '?kind=PDF', Buffer.from('%PDF-1.4')).expect(401);
    });

    it('o limite de 25 MB aplica-se; um anónimo com corpo grande leva 401 sem o servidor o guardar', async () => {
      // o servidor pode fechar a ligação antes de receber tudo (EPIPE/ECONNRESET): para o cliente também é uma recusa
      const outcome = (p: PromiseLike<{ status: number }>) => Promise.resolve(p).then((r) => r.status, (e: NodeJS.ErrnoException) => (['EPIPE', 'ECONNRESET'].includes(e.code ?? '') ? 'fechada' : Promise.reject(e)));
      expect([413, 'fechada']).toContain(await outcome(up('com', '?kind=PDF', Buffer.alloc(26 * 1024 * 1024, 1))));
      expect([401, 'fechada']).toContain(await outcome(up(null, '?kind=PDF', Buffer.alloc(2 * 1024 * 1024, 1))));
    });

    it('o download usa nosniff, attachment e nome codificado', async () => {
      const docs = (await h.http().get(`/api/v1/proposals/${ids['prop']}/documents`).set(A('com')).expect(200)).body;
      const r = await h.http().get(`/api/v1/proposals/${ids['prop']}/documents/${docs[0].id}/download`).set(A('com')).expect(200);
      expect(r.headers['content-disposition']).toMatch(/^attachment; filename="[\w%.-]+"$/);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('XSS no HTML das secções e dos blocos', () => {
    const evil = '<p onclick="x()">ola</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">l</a><a href=" JaVaScRiPt:alert(1)">l2</a><iframe src="//e.com"></iframe><a href="https://ok.pt" onmouseover="x()">ok</a><svg><script>alert(2)</script></svg><style>*{}</style>';
    const bad = /<script|<img|<iframe|<svg|<style|onclick|onerror|onmouseover|javascript:/i;

    it('sai sanitizado da API (secção)', async () => {
      const id = await proposalOf('com', 'XSS');
      await h.http().post(`/api/v1/proposals/${id}/sections`).set(A('com')).send({ title: '<img src=x onerror=alert(1)>' }).expect(201);
      const s = (await h.http().get(`/api/v1/proposals/${id}/sections`).set(A('com'))).body[0];
      const r = await h.http().put(`/api/v1/proposals/${id}/sections/${s.id}`).set(A('com')).send({ rowVersion: s.rowVersion, html: evil }).expect(200);
      expect(r.body[0].html).not.toMatch(bad);
      expect(r.body[0].html).toContain('href="https://ok.pt"');
    });

    it('sai sanitizado da API (biblioteca de blocos)', async () => {
      const b = await h.http().post('/api/v1/content/blocks').set(A('adm')).send({ code: 'XSS', title: 'x', isLegal: false, language: 'pt-PT', reviewDueDate: '2027-01-01', bodyHtml: evil }).expect(201);
      expect(JSON.stringify(b.body)).not.toMatch(bad);
    });
  });

  describe('condições JSONLogic maliciosas', () => {
    const nest = (depth: number): object => (depth === 0 ? { var: 'x' } : { and: [nest(depth - 1)] });
    const rule = (condition: unknown) => ({ sourceProductId: ids['prod'], targetProductId: undefined, ruleType: 'CONSTRAINT', condition, validFrom: '2026-01-01', message: 'm' });
    const policy = (condition: unknown) => ({ name: 'p', scope: 'COMMERCIAL', mode: 'SEQUENTIAL', validFrom: '2026-01-01', condition, levels: [{ level: 1, role: 'Gestor_Comercial', slaHours: 1 }] });

    it('regras: demasiado fundas ou demasiado grandes dão 422; operador desconhecido também', async () => {
      await h.http().post('/api/v1/rules').set(A('adm')).send(rule(nest(60))).expect(422);
      await h.http().post('/api/v1/rules').set(A('adm')).send(rule({ or: Array.from({ length: 600 }, () => ({ '==': [1, 1] })) })).expect(422);
      await h.http().post('/api/v1/rules').set(A('adm')).send(rule({ inventado: [1] })).expect(422);
      await h.http().post('/api/v1/rules').set(A('com')).send(rule({ '==': [1, 1] })).expect(403);
    });

    it('políticas: idem', async () => {
      await h.http().post('/api/v1/approval-policies').set(A('adm')).send(policy(nest(60))).expect(422);
      await h.http().post('/api/v1/approval-policies').set(A('adm')).send(policy({ or: Array.from({ length: 600 }, () => ({ '==': [1, 1] })) })).expect(422);
      await h.http().post('/api/v1/approval-policies').set(A('adm')).send({ ...policy(null), levels: Array.from({ length: 11 }, (_, i) => ({ level: i + 1, role: 'Gestor_Comercial', slaHours: 1 })) }).expect(400);
    });
  });

  // -- cabeçalhos e limites -----------------------------------------------------------------------
  describe('cabeçalhos de segurança e limites de pedido', () => {
    const check = (headers: Record<string, unknown>) => {
      expect(headers['content-security-policy']).toContain("default-src 'none'");
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['strict-transport-security']).toBeDefined();
      expect(headers['x-powered-by']).toBeUndefined();
      expect(headers['access-control-allow-credentials']).toBeUndefined(); // sem cookies: CSRF não se aplica
    };

    it('presentes em respostas normais e de erro (200, 401, 403, 404, 422)', async () => {
      check((await h.http().get('/api/v1/health').expect(200)).headers);
      check((await h.http().get('/api/v1/me').expect(401)).headers);
      check((await h.http().get('/api/v1/users').set(A('com')).expect(403)).headers);
      check((await h.http().get('/api/v1/nao-existe').expect(404)).headers);
      check((await h.http().get(`/api/v1/proposals/${ids['prop']}`).set(A('outro')).expect(404)).headers);
      check((await h.http().post('/api/v1/auth/login').send({ email: 'x' }).expect(400)).headers);
    });

    it('erros não vazam pilhas nem detalhes internos', async () => {
      const r = await h.http().get('/api/v1/proposals/nao-e-uuid').set(A('com')).expect(400);
      expect(JSON.stringify(r.body)).not.toMatch(/node_modules|at \w+ \(|prisma/i);
    });

    it('autenticação por cabeçalho Authorization: não há cookies de sessão (CSRF)', async () => {
      const r = await h.http().post('/api/v1/auth/login').send({ email: 'comercial.dono@teste.pt', password: 'Teste-Pass-2026!' }).expect(201);
      expect(r.headers['set-cookie']).toBeUndefined();
      await h.http().get('/api/v1/me').set('Cookie', `token=${r.body.accessToken}`).expect(401);
    });

    it('o corpo JSON tem limite (413)', async () => {
      await h.http().post('/api/v1/auth/login').send({ email: 'a@b.pt', password: 'x'.repeat(300_000) }).expect(413);
    });

    it('CORS só aceita a origem configurada', async () => {
      const r = await h.http().get('/api/v1/health').set('Origin', 'https://evil.example');
      expect(r.headers['access-control-allow-origin']).not.toBe('https://evil.example');
      expect(r.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('portal: tokens inválidos', () => {
    it('token com forma inválida, desconhecido ou muito longo dão todos 404 igual', async () => {
      const bodies = new Set<string>();
      for (const t of ['x', 'A'.repeat(43), 'A'.repeat(500), '..%2F..%2Fetc%2Fpasswd']) {
        const r = await h.http().get(`/api/v1/portal/${t}`).expect(404);
        bodies.add(r.body.detail);
      }
      expect(bodies.size).toBe(1);
      await h.http().post(`/api/v1/portal/${'A'.repeat(43)}/response`).send({ decision: 'ACCEPTED', signerName: 'Eu', signerEmail: 'e@e.pt', confirmRead: true }).expect(404);
    });
  });
});
