// Utilitários dos testes de carga: estatística, gerador de carga com concorrência e amostragem de CPU/RAM.
import { execFileSync } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export function summarize(latencies) {
  const s = [...latencies].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    min: s[0] ?? NaN,
    mean: s.length ? sum / s.length : NaN,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1] ?? NaN,
  };
}

/**
 * Executa `total` chamadas de `task(i, worker)` com `concurrency` workers em paralelo.
 * `task` devolve { status, ms? } ou lança. Códigos listados em `expected` não contam como erro.
 */
export async function runLoad({ total, concurrency, task, expected = [200, 201, 202, 204] }) {
  const lat = [];
  const codes = {};
  let errors = 0;
  let next = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async (_, worker) => {
      for (;;) {
        const i = next++;
        if (i >= total) return;
        const t = performance.now();
        try {
          const { status } = await task(i, worker);
          const ms = performance.now() - t;
          codes[status] = (codes[status] ?? 0) + 1;
          if (expected.includes(status)) lat.push(ms);
          else errors++;
        } catch (e) {
          errors++;
          codes[e.code ?? e.name ?? 'EXC'] = (codes[e.code ?? e.name ?? 'EXC'] ?? 0) + 1;
        }
      }
    }),
  );
  const wall = (performance.now() - t0) / 1000;
  return { concurrency, requests: total, ok: lat.length, errors, codes, wallSeconds: wall, rps: lat.length / wall, ...summarize(lat) };
}

/** Cliente HTTP mínimo. */
export function http(base, { retries = 0 } = {}) {
  async function call(method, path, opts = {}, attempt = 0) {
    const { token, body, headers = {} } = opts;
    let res;
    try {
      res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if (attempt < retries) { await sleep(500); return call(method, path, opts, attempt + 1); }
      throw e;
    }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, json, text };
  }
  return { call, get: (p, o) => call('GET', p, o), post: (p, b, o) => call('POST', p, { ...o, body: b }), put: (p, b, o) => call('PUT', p, { ...o, body: b }) };
}

/** Amostra %CPU e RSS (MiB) de uma lista de processos a cada `intervalMs`. Em macOS/Linux via `ps`. */
export function sampler(pids, intervalMs = 500) {
  const samples = {};
  let stop = false;
  const loop = (async () => {
    while (!stop) {
      for (const [name, h] of Object.entries(pids)) {
        const pid = typeof h === 'object' ? h?.pid : h;
        if (!pid) continue;
        try {
          const out = execFileSync('ps', ['-o', '%cpu=,rss=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
          (samples[name] ??= []).push({ cpu: Number(out[0]), rss: Number(out[1]) / 1024 });
        } catch { /* processo terminou */ }
      }
      await sleep(intervalMs);
    }
  })();
  return async () => {
    stop = true;
    await loop;
    return Object.fromEntries(
      Object.entries(samples).map(([k, v]) => [k, { cpuAvg: v.reduce((a, b) => a + b.cpu, 0) / v.length, cpuMax: Math.max(...v.map((x) => x.cpu)), rssMaxMiB: Math.max(...v.map((x) => x.rss)) }]),
    );
  };
}

export const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');
