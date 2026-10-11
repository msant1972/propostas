#!/usr/bin/env node
// Testes de carga da API (pnpm perf). Prepara a base cpq_perf, arranca API (3100, e 3101 para o portal sem limite)
// e worker, cria os dados, corre os cenários, compara com as metas e escreve out/perf-report.{json,md}.
//
// Variáveis: PERF_KEEP_DB=1 (não recria a base), PERF_NO_SPAWN=1 (usa API/worker já a correr em 3100/3101),
//            PERF_QUICK=1 (volumes pequenos, para validar o script), PERF_ONLY=login,lists,... (subconjunto).
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmt, http, runLoad, sampler, sleep, summarize } from './lib.mjs';
import { writeReports } from './report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'scripts/perf/out');
const TOOLS = process.env.CPQ_TOOLS ?? path.join(os.homedir(), 'tools');
const MARIADB = path.join(TOOLS, 'mariadb/bin/mariadb');
const SOCKET = path.join(TOOLS, 'data/mariadb.sock');
const DB = 'cpq_perf';
const DB_URL = `mysql://cpq:cpq@127.0.0.1:3306/${DB}`;
const REDIS_DB = 2;
const PORT = 3100; // API com os limites reais do portal
const PORT_OPEN = 3101; // API só para medir o débito do portal sem o limite por IP
const STORAGE = path.join(os.tmpdir(), 'cpq-perf-storage');
const PASS = 'Demo-Pass-2026!';
const QUICK = !!process.env.PERF_QUICK;
const ONLY = process.env.PERF_ONLY ? new Set(process.env.PERF_ONLY.split(',')) : null;
const want = (id) => !ONLY || ONLY.has(id);
const LINES = 200;
const PROPOSALS = 20;

const log = (...a) => console.log(...a);
const sql = (q, useDb = false) => execFileSync(MARIADB, [`--socket=${SOCKET}`, '-uroot', '-N', '-B', ...(useDb ? ['-D', DB] : []), '-e', q], { encoding: 'utf8' });

function redisFlush() {
  return new Promise((resolve) => {
    const s = net.connect(6379, '127.0.0.1', () => s.write(`SELECT ${REDIS_DB}\r\nFLUSHDB\r\nQUIT\r\n`));
    s.on('data', () => {});
    s.on('close', resolve);
    s.on('error', resolve);
  });
}

async function pool(items, concurrency, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// -- processos ---------------------------------------------------------------------------------

const children = [];
const restarts = [];
let stopping = false;
// Arranca um processo e reinicia-o se for morto por fora (outros agentes/ferramentas no mesmo computador), registando-o.
function start(name, cwd, env) {
  const handle = { name, pid: 0, proc: null };
  const file = path.join(OUT, `${name}.log`);
  writeFileSync(file, '');
  const launch = () => {
    const p = spawn('node', ['--import', '@swc-node/register/esm-register', 'src/main.ts'], { cwd: path.join(ROOT, cwd), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => appendFileSync(file, d));
    p.stderr.on('data', (d) => appendFileSync(file, d));
    p.on('exit', (code, signal) => {
      if (stopping) return;
      restarts.push(`${name}: terminou (código ${code}, sinal ${signal}) e foi reiniciado`);
      log(`[${name}] terminou inesperadamente (código ${code}, sinal ${signal}); a reiniciar`);
      setTimeout(launch, 500);
    });
    handle.proc = p;
    handle.pid = p.pid;
  };
  launch();
  children.push(handle);
  return handle;
}
const stopAll = () => { stopping = true; children.forEach((h) => { try { h.proc.kill('SIGTERM'); } catch { /* já terminou */ } }); };
process.on('SIGINT', () => { stopAll(); process.exit(130); });

async function waitHealth(port) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/v1/health`)).ok) return; } catch { /* ainda a arrancar */ }
    await sleep(500);
  }
  throw new Error(`API na porta ${port} não arrancou`);
}

// -- dados ---------------------------------------------------------------------------------------

const lineFor = (i, productIds, recurring) => ({
  productId: productIds[i],
  quantity: String(1 + ((i * 7) % 120)),
  ...(recurring[i] ? { termMonths: [12, 24, 36][i % 3] } : {}),
  discountPercent: i % 3 === 0 ? String(5 + (i % 10)) : '0',
  ...(i % 5 === 0 ? { attributes: { sites: 1 + (i % 50), regiao: 'PT' } } : {}),
});

async function prepare(api) {
  const login = async (email) => {
    const r = await api.post('/api/v1/auth/login', { email, password: PASS });
    if (r.status >= 300) throw new Error(`login ${email}: ${r.status} ${r.text}`);
    return r.json.accessToken;
  };
  const admin = await login('admin@exemplo.pt');
  const user = await login('comercial@exemplo.pt');
  const A = { token: admin };
  const U = { token: user };
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text.slice(0, 300)}`); return r.json; };

  log('A preparar dados: 200 produtos, atributos, escalões, regras...');
  const idx = [...Array(LINES).keys()];
  const recurring = idx.map((i) => i % 4 <= 1);
  const productIds = await pool(idx, 10, async (i) => {
    const kind = i % 4;
    const r = must(await api.post('/api/v1/catalog/products', {
      sku: `PERF-${String(i).padStart(3, '0')}`, name: `Produto de carga ${i}`,
      billingModel: kind <= 1 ? 'RECURRING' : 'ONE_TIME', billingPeriod: kind === 0 ? 'MONTH' : kind === 1 ? 'YEAR' : undefined,
      unitCost: String(5 + (i % 17)), taxCategory: kind === 3 ? 'REDUCED' : 'STANDARD',
    }, A), 'criar produto');
    return r.id;
  });
  await pool(idx.filter((i) => i % 5 === 0), 1, (i) => api.put(`/api/v1/catalog/products/${productIds[i]}/attributes`, {
    attributes: [
      { code: 'sites', label: 'Sítios', dataType: 'INTEGER', minValue: '1', maxValue: '500', isRequired: true },
      { code: 'regiao', label: 'Região', dataType: 'LIST', allowedValues: ['PT', 'ES', 'FR'], isRequired: true },
    ],
  }, A).then((r) => must(r, 'atributos')));

  const lists = must(await api.get('/api/v1/price-lists', A), 'listas');
  const geral = lists.find((l) => l.name === 'Geral EUR');
  const existing = must(await api.get(`/api/v1/price-lists/${geral.id}/items`, A), 'itens').map((x) => ({ productId: x.productId, minQuantity: x.minQuantity, unitPrice: x.unitPrice }));
  const mine = idx.flatMap((i) => [['0', 100 + i], ['10', 90 + i], ['50', 80 + i]].map(([q, p]) => ({ productId: productIds[i], minQuantity: q, unitPrice: `${p}.0000` })));
  must(await api.put(`/api/v1/price-lists/${geral.id}/items`, { items: [...existing, ...mine] }, A), 'itens da lista');

  const rules = [];
  for (const i of idx) {
    rules.push({
      sourceProductId: productIds[i], ruleType: 'CONSTRAINT', params: { field: 'quantity', min: 1, max: 10000 }, validFrom: '2026-01-01',
      condition: { and: [{ '>': [{ var: 'source.quantity' }, 0] }, { '==': [{ var: 'client.isBusiness' }, true] }] },
    });
    if (i % 3 === 0 && i > 0) rules.push({ sourceProductId: productIds[i], targetProductId: productIds[i - 1], ruleType: 'REQUIRES', validFrom: '2026-01-01', condition: { or: [{ '>=': [{ var: 'source.quantity' }, 5] }, { in: [{ var: 'client.countryCode' }, ['PT', 'ES']] }] } });
    if (i % 7 === 0 && i + 1 < LINES) rules.push({ sourceProductId: productIds[i], targetProductId: productIds[i + 1], ruleType: 'RECOMMENDS', validFrom: '2026-01-01', condition: { '>': [{ var: 'quote.lineCount' }, 3] } });
  }
  await pool(rules, 10, (b) => api.post('/api/v1/rules', b, A).then((r) => must(r, 'regra')));

  const client = must(await api.post('/api/v1/clients', { code: 'PERF-CLI', name: 'Cliente de Carga, Lda.', vatNumber: '500000001', countryCode: 'PT', vatValid: true }, A), 'cliente');
  const blocks = must(await api.get('/api/v1/content/blocks?pageSize=20', U), 'blocos');
  const blockVersionIds = (blocks.items ?? blocks).flatMap((b) => b.versions.filter((v) => v.status === 'APPROVED').map((v) => v.id)).slice(0, 4);

  log('A criar propostas e a gravar cotações de 200 linhas...');
  const proposals = await pool([...Array(PROPOSALS + 1).keys()], 5, async (n) => {
    const p = must(await api.post('/api/v1/proposals', { title: `Proposta de carga ${n}`, clientId: client.id, validUntil: '2027-12-31' }, U), 'proposta');
    const v = must(await api.get(`/api/v1/proposals/${p.id}/quotes/current`, U), 'versão');
    const saved = await api.put(`/api/v1/proposals/${p.id}/quotes/${v.id}`, { globalDiscountPercent: '3', lines: idx.map((i) => lineFor(i, productIds, recurring)) }, U);
    must(saved, 'gravar cotação inicial');
    for (const blockVersionId of blockVersionIds) must(await api.post(`/api/v1/proposals/${p.id}/sections`, { blockVersionId }, U), 'secção');
    // Secção com a tabela de preços (200 linhas) no documento.
    const tab = must(await api.post(`/api/v1/proposals/${p.id}/sections`, { title: 'Proposta económica' }, U), 'secção de preços').at(-1);
    must(await api.put(`/api/v1/proposals/${p.id}/sections/${tab.id}`, { html: '<p>{{tabela_precos}}</p>', rowVersion: tab.rowVersion }, U), 'html da secção de preços');
    return { id: p.id, code: p.code, versionId: v.id, total: saved.json.totals.grandTotal };
  });
  return { A, U, productIds, recurring, proposals: proposals.slice(0, PROPOSALS), portalProposal: proposals[PROPOSALS], clientId: client.id, counts: { products: LINES, rules: rules.length, priceListItems: mine.length + existing.length, sections: blockVersionIds.length } };
}

// -- cenários ------------------------------------------------------------------------------------

const row = (label, s, meta) => ({ label, ...s, verdict: meta === undefined ? '-' : s.errors === 0 && s.p95 < meta ? 'OK' : 'FALHA' });

async function main() {
  mkdirSync(OUT, { recursive: true });
  const base = `http://127.0.0.1:${PORT}`;
  const api = http(base);
  const setupApi = http(base, { retries: 60 }); // só na preparação: tolera ligações fechadas pelo servidor
  const apiOpen = http(`http://127.0.0.1:${PORT_OPEN}`);
  const results = [];
  const env = {
    DATABASE_URL: DB_URL, REDIS_URL: `redis://127.0.0.1:6379/${REDIS_DB}`, DOCUMENT_STORAGE_DIR: STORAGE,
    AUDIT_EXPORT_DIR: path.join(os.tmpdir(), 'cpq-perf-audit'), MAIL_OUTBOX_DIR: path.join(os.tmpdir(), 'cpq-perf-mail'),
    LOGIN_RATE_PER_MINUTE: '1000000', THROTTLE_LIMIT: '1000000', SCHEDULER_ENABLED: 'false',
  };
  const pids = {};
  const spawnEnv = { ...process.env, ...env };

  if (!process.env.PERF_NO_SPAWN) {
    if (!process.env.PERF_KEEP_DB) {
      log(`A recriar a base ${DB}...`);
      sql(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON ${DB}.* TO 'cpq'@'127.0.0.1';`);
      execFileSync('pnpm', ['db:migrate'], { cwd: ROOT, env: spawnEnv, stdio: 'ignore' });
      execFileSync('pnpm', ['db:seed'], { cwd: ROOT, env: spawnEnv, stdio: 'ignore' });
      await redisFlush();
      rmSync(STORAGE, { recursive: true, force: true });
    }
    pids.api = start('api', 'apps/api', { ...env, PORT: String(PORT), PORTAL_RATE_PER_MINUTE: '30' });
    pids.apiOpen = start('api-aberta', 'apps/api', { ...env, PORT: String(PORT_OPEN), PORTAL_RATE_PER_MINUTE: '1000000' });
    pids.worker = start('worker', 'apps/worker', env);
  }
  try {
    await waitHealth(PORT);
    await waitHealth(PORT_OPEN);
    try { pids.mariadb = Number(readFileSync(path.join(TOOLS, 'data/mariadb.pid'), 'utf8').trim()); } catch { /* sem pid */ }

    const d = await prepare(setupApi);
    const U = d.U;
    const q = (n, full) => (QUICK ? Math.max(5, Math.floor(n / 10)) : n) * (full ?? 1);
    const withSampler = async (fn) => { const stop = sampler(pids); const r = await fn(); return { ...r, resources: await stop() }; };

    // (a) login ------------------------------------------------------------------------------
    if (want('login')) {
      log('\n(a) login (scrypt)');
      const res = await withSampler(async () => {
        const rows = [];
        for (const c of [1, 5, 20]) {
          const s = await runLoad({ total: q(c === 1 ? 40 : 100), concurrency: c, task: async () => ({ status: (await api.post('/api/v1/auth/login', { email: 'comercial@exemplo.pt', password: PASS })).status }) });
          rows.push(row(`login, concorrência ${c}`, s, 500));
          log(`  c=${c}: p50=${fmt(s.p50)} p95=${fmt(s.p95)} p99=${fmt(s.p99)} ms, ${fmt(s.rps)} req/s, erros ${s.errors}`);
        }
        return { rows };
      });
      results.push({ id: 'login', title: '(a) Login (scrypt)', goal: 'Referência interna: p95 < 500 ms (sem meta formal); mede o custo de CPU do scrypt', ...res });
    }

    // (b) leituras ---------------------------------------------------------------------------
    if (want('lists')) {
      log('\n(b) listas');
      const p0 = d.proposals[0];
      const reads = [
        ['GET /proposals (20 por página)', '/api/v1/proposals?pageSize=20'],
        ['GET /proposals?q=carga (pesquisa)', '/api/v1/proposals?q=carga&pageSize=20'],
        ['GET /catalog/products (20 por página)', '/api/v1/catalog/products?pageSize=20'],
        ['GET /cpq/catalog (catálogo completo do motor)', '/api/v1/cpq/catalog'],
        [`GET /proposals/:id/quotes/:versionId (${LINES} linhas)`, `/api/v1/proposals/${p0.id}/quotes/${p0.versionId}`],
      ];
      const res = await withSampler(async () => {
        const rows = [];
        for (const [label, url] of reads) {
          const s = await runLoad({ total: q(300), concurrency: 10, task: async () => ({ status: (await api.get(url, U)).status }) });
          rows.push(row(`${label}, c=10`, s, 200));
          log(`  ${label}: p50=${fmt(s.p50)} p95=${fmt(s.p95)} p99=${fmt(s.p99)} ms, ${fmt(s.rps)} req/s, erros ${s.errors}`);
        }
        return { rows };
      });
      results.push({ id: 'lists', title: '(b) Listagens e leituras', goal: 'Referência interna: p95 < 200 ms com 10 pedidos em simultâneo', ...res });
    }

    // (c) gravar cotações de 200 linhas -----------------------------------------------------------
    if (want('save')) {
      log('\n(c) gravar cotações de 200 linhas');
      const res = await withSampler(async () => {
        const rows = [];
        for (const c of [1, 5, 20]) {
          const s = await runLoad({
            total: q(c === 1 ? 40 : c === 5 ? 100 : 200), concurrency: c,
            task: async (i, w) => {
              const p = d.proposals[w % d.proposals.length];
              const lines = [...Array(LINES).keys()].map((k) => lineFor(k, d.productIds, d.recurring));
              lines[i % LINES].quantity = String(1 + ((i * 13) % 120)); // muda sempre qualquer coisa
              return { status: (await api.put(`/api/v1/proposals/${p.id}/quotes/${p.versionId}`, { globalDiscountPercent: '3', lines }, U)).status };
            },
          });
          rows.push(row(`PUT cotação ${LINES} linhas, concorrência ${c}`, s, 500));
          log(`  c=${c}: p50=${fmt(s.p50)} p95=${fmt(s.p95)} p99=${fmt(s.p99)} ms, ${fmt(s.rps)} req/s, erros ${s.errors} ${JSON.stringify(s.codes)}`);
        }
        const pv = await runLoad({ total: q(100), concurrency: 5, task: async () => ({ status: (await api.post(`/api/v1/proposals/${d.proposals[0].id}/quotes/preview`, { lines: [...Array(LINES).keys()].map((k) => lineFor(k, d.productIds, d.recurring)) }, U)).status }) });
        rows.push(row(`POST preview ${LINES} linhas (servidor, sem gravar), c=5`, pv, 500));
        log(`  preview: p50=${fmt(pv.p50)} p95=${fmt(pv.p95)} ms`);
        return { rows };
      });
      results.push({ id: 'save', title: '(c) Recalcular e gravar cotação (200 linhas)', goal: 'Meta: p95 < 500 ms', ...res });
    }

    // (d) geração de documentos --------------------------------------------------------------------
    if (want('docs')) {
      const N = QUICK ? 4 : 20;
      log(`\n(d) geração de DOCX+PDF: ${N} em simultâneo`);
      const res = await withSampler(async () => {
        const one = async (p) => {
          const t = performance.now();
          const r = await api.post(`/api/v1/proposals/${p.id}/documents/compile`, {}, U);
          if (r.status !== 202) return { error: `${r.status} ${r.text.slice(0, 600)}` };
          const eventId = r.json.eventId;
          const accepted = performance.now() - t;
          for (;;) {
            await sleep(200);
            const j = await api.get(`/api/v1/proposals/${p.id}/documents/jobs/${eventId}`, U);
            if (j.json?.status === 'DONE') return { ms: performance.now() - t, accepted };
            if (j.json?.status === 'FAILED') return { error: `FAILED ${j.json.error}` };
            if (performance.now() - t > 180_000) return { error: 'timeout 180 s' };
          }
        };
        const single = await one(d.proposals[0]);
        log(`  1 pedido isolado: ${single.error ?? fmt(single.ms, 0) + ' ms'}`);
        const t0 = performance.now();
        const all = await Promise.all(d.proposals.slice(0, N).map(one));
        const wall = performance.now() - t0;
        const good = all.filter((x) => x.ms);
        const s = summarize(good.map((x) => x.ms));
        const acc = summarize(good.map((x) => x.accepted));
        const errors = all.length - good.length;
        log(`  ${N} em simultâneo: tudo DONE em ${fmt(wall / 1000, 2)} s; por pedido p50=${fmt(s.p50, 0)} p95=${fmt(s.p95, 0)} max=${fmt(s.max, 0)} ms; resposta 202 p95=${fmt(acc.p95)} ms; erros ${errors}`);
        const rows = [];
        if (!single.error) rows.push({ label: 'Pedido isolado (pedido até DONE)', n: 1, ok: 1, errors: 0, p50: single.ms, p95: single.ms, p99: single.ms, max: single.ms, mean: single.ms, verdict: single.ms < 60000 ? 'OK' : 'FALHA' });
        rows.push({ ...row(`${N} em simultâneo (pedido até DONE)`, { ...s, ok: good.length, errors, requests: N }, 60000) });
        rows.push({ ...row('Resposta 202 da API (não bloqueia)', { ...acc, ok: good.length, errors: 0, requests: N }, 500) });
        return { rows, extra: { wallSecondsAllDone: wall / 1000, failures: all.filter((x) => x.error).map((x) => x.error) } };
      });
      results.push({ id: 'docs', title: '(d) Geração DOCX + PDF (assíncrona)', goal: 'Meta: p95 < 60 s do pedido até DONE; resposta 202 imediata', ...res });
    }

    // (e) portal público -------------------------------------------------------------------------------
    if (want('portal')) {
      log('\n(e) portal público');
      const mk = (n) => {
        const proposalId = d.portalProposal.id;
        const tokens = Array.from({ length: n }, () => randomBytes(32).toString('base64url'));
        sql(`
          SET @p='${proposalId}'; SET @v='${d.portalProposal.versionId}'; SET @u=(SELECT id FROM users WHERE email='comercial@exemplo.pt');
          UPDATE proposals SET status='SENT' WHERE id=@p;
          INSERT IGNORE INTO documents (id, proposal_id, quote_version_id, kind, origin, folder, file_name, storage_key, sha256, size_bytes, created_by)
            VALUES ('${'00000000-0000-7000-8000-000000000001'}', @p, @v, 'PDF', 'GENERATED', '02_Enviado', 'perf.pdf', 'perf/perf.pdf', REPEAT('a',64), 1000, @u);
          ${tokens.map((t) => `INSERT INTO share_links (id, proposal_id, document_id, token_hash, expires_at, created_by) VALUES (UUID(), @p, '00000000-0000-7000-8000-000000000001', '${createHash('sha256').update(t).digest('hex')}', NOW() + INTERVAL 30 DAY, @u);`).join('\n')}
        `, true);
        return tokens;
      };
      const [t1] = mk(1);
      const more = mk(19);
      const all = [t1, ...more];
      const res = await withSampler(async () => {
        const rows = [];
        // Limite real: 60 pedidos seguidos do mesmo IP com PORTAL_RATE_PER_MINUTE=30.
        const lim = await runLoad({ total: 60, concurrency: 1, expected: [200, 429], task: async () => ({ status: (await api.get(`/api/v1/portal/${t1}`)).status }) });
        const ok200 = lim.codes[200] ?? 0;
        const n429 = lim.codes[429] ?? 0;
        log(`  limite real (30/min): 200=${ok200}, 429=${n429}`);
        rows.push({ ...row('Limite por IP (30/min): 60 pedidos seguidos', lim, undefined), verdict: ok200 === 30 && n429 === 30 ? 'OK' : ok200 <= 31 && n429 >= 29 ? 'OK' : 'FALHA', note: `200=${ok200}, 429=${n429}` });
        // Débito sem limite (API na 3101): uma só ligação (linha quente) e 20 ligações.
        for (const [label, tokens, c] of [['1 ligação (pior caso: mesma linha)', [t1], 20], ['20 ligações distintas', all, 20]]) {
          const s = await runLoad({ total: q(2000), concurrency: c, task: async (i) => ({ status: (await apiOpen.get(`/api/v1/portal/${tokens[i % tokens.length]}`)).status }) });
          rows.push(row(`GET /portal/:token, ${label}, c=${c} (sem limite)`, s, 200));
          log(`  ${label}: p50=${fmt(s.p50)} p95=${fmt(s.p95)} p99=${fmt(s.p99)} ms, ${fmt(s.rps)} req/s, erros ${s.errors}`);
        }
        const bad = await runLoad({ total: q(1000), concurrency: 20, expected: [404], task: async () => ({ status: (await apiOpen.get(`/api/v1/portal/${randomBytes(32).toString('base64url')}`)).status }) });
        rows.push(row('GET /portal/:token inválido (404), c=20', bad, 200));
        log(`  token inválido: p50=${fmt(bad.p50)} p95=${fmt(bad.p95)} ms, ${fmt(bad.rps)} req/s`);
        return { rows };
      });
      results.push({ id: 'portal', title: '(e) Portal público do cliente', goal: 'Referência interna: p95 < 200 ms; o limite por IP tem de devolver 429 depois de 30 pedidos/min', ...res });
    }

    const machine = {
      cpu: os.cpus()[0].model, cores: os.cpus().length, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), platform: `${os.platform()} ${os.release()}`, node: process.version,
      date: new Date().toISOString(),
    };
    const report = { restarts, machine, dataset: d.counts, quick: QUICK, scenarios: results };
    writeReports(OUT, report);
    log(`\nRelatório: ${path.join(OUT, 'perf-report.md')}`);
    const failed = results.flatMap((r) => r.rows).filter((r) => r.verdict === 'FALHA');
    log(failed.length ? `FALHAS: ${failed.map((f) => f.label).join(' | ')}` : 'Todas as metas cumpridas.');
  } finally {
    stopAll();
    await sleep(500);
  }
}

main().catch((e) => { console.error(e); stopAll(); process.exit(1); });
