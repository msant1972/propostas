// Micro-benchmark do motor de regras (meta: p95 < 50 ms para cotações até 200 linhas, no browser).
// Corre com:  pnpm perf:bench   (compila o motor e executa este ficheiro com o Node 24, sem transpiler).
// Escreve também packages/rules-engine/bench/resultado.json (ou o caminho em BENCH_OUT).
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { calculateQuote, evaluateRules } from '../dist/index.js';
import type { QuoteInput } from '../dist/index.js';
import { benchCatalog, benchQuote } from './dataset.ts';

const META_MS = 50;
const SIZES = [10, 50, 100, 200];
const catalog = benchCatalog();

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0]!,
    p50: percentile(s, 50),
    p95: percentile(s, 95),
    p99: percentile(s, 99),
    max: s[s.length - 1]!,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

function measure(fn: () => unknown, iterations: number, warmup = 200): number[] {
  for (let i = 0; i < warmup; i++) fn();
  const out: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return out;
}

const f = (x: number) => x.toFixed(3).padStart(8);
const row = (label: string, s: ReturnType<typeof stats>, meta = true) =>
  console.log(`${label.padEnd(34)} p50=${f(s.p50)} p95=${f(s.p95)} p99=${f(s.p99)} max=${f(s.max)} ms  ${meta ? (s.p95 < META_MS ? 'OK' : 'FALHA') : ''}`);

const result: Record<string, unknown> = {
  node: process.version, platform: `${process.platform}/${process.arch}`, products: catalog.products.length, rules: catalog.rules.length,
  priceListItems: catalog.priceLists[0]!.items.length, metaP95Ms: META_MS,
};

// 1. Primeira chamada (JIT frio): é o que o utilizador sente ao abrir a cotação.
const cold: Record<string, number> = {};
for (const n of [...SIZES].reverse()) {
  const t = performance.now();
  calculateQuote(benchQuote(n), catalog);
  cold[String(n)] = performance.now() - t;
}
console.log('Primeira chamada (frio):', Object.entries(cold).map(([n, ms]) => `${n} linhas ${ms.toFixed(2)} ms`).join(' | '));
result['cold'] = cold;

// 2. calculateQuote completo, regime estável.
console.log('\ncalculateQuote (preços + impostos + regras + atributos), regime estável');
const calc: Record<string, unknown> = {};
for (const n of SIZES) {
  const q = benchQuote(n);
  const r = calculateQuote(q, catalog);
  if (!r.valid) throw new Error(`cotação de ${n} linhas inválida: ${JSON.stringify(r.violations.slice(0, 3))}`);
  const s = stats(measure(() => calculateQuote(q, catalog), n >= 100 ? 1500 : 3000));
  row(`${n} linhas`, s);
  calc[String(n)] = s;
}
result['calculateQuote'] = calc;

// 3. Só a validação de regras (evaluateRules), parte do cálculo.
console.log('\nevaluateRules (só regras JSONLogic, atributos e bundles)');
const evalOnly: Record<string, unknown> = {};
for (const n of SIZES) {
  const q = benchQuote(n);
  const s = stats(measure(() => evaluateRules(q, catalog), 2000));
  row(`${n} linhas`, s);
  evalOnly[String(n)] = s;
}
result['evaluateRules'] = evalOnly;

// 4. Pré-visualização a cada tecla: 200 linhas, muda-se uma quantidade e recalcula-se tudo.
console.log('\nPré-visualização a cada tecla (200 linhas, 1 linha alterada por tecla)');
const base = benchQuote(200);
let k = 0;
const keystroke = () => {
  const lines = base.lines.map((l, i) => (i === k % 200 ? { ...l, quantity: String(1 + (k % 999)) } : l));
  k++;
  const q: QuoteInput = { ...base, lines };
  return calculateQuote(q, catalog);
};
const keys = stats(measure(keystroke, 2000));
row('recalculo completo por tecla', keys);
// Rajada: 10 teclas/s durante 10 s de escrita contínua = fração de CPU de uma thread (main thread do browser).
const burstStart = performance.now();
for (let i = 0; i < 100; i++) keystroke();
const burstMs = performance.now() - burstStart;
const cpuShare = (burstMs / 100) * 10 / 1000; // ms por tecla * 10 teclas/s / 1000 ms
console.log(`  100 teclas seguidas: ${burstMs.toFixed(1)} ms no total; a 10 teclas/s ocupa ${(cpuShare * 100).toFixed(1)} % do thread principal`);
const frameBudget = 16.7;
console.log(`  orçamento de uma frame a 60 fps = ${frameBudget} ms; p95 por tecla = ${keys.p95.toFixed(2)} ms -> ${keys.p95 > frameBudget ? 'ultrapassa uma frame (usar debounce de ~150 ms ou Web Worker)' : 'cabe numa frame'}`);
result['keystroke200'] = { ...keys, burst100Ms: burstMs, cpuShareAt10KeysPerSec: cpuShare };

// 5. Memória.
const heap = process.memoryUsage().heapUsed / 1048576;
console.log(`\nHeap usado no fim: ${heap.toFixed(1)} MiB`);
result['heapMiB'] = heap;

const worst = Math.max(...SIZES.map((n) => (calc[String(n)] as { p95: number }).p95));
result['worstP95Ms'] = worst;
result['verdict'] = worst < META_MS && keys.p95 < META_MS ? 'OK' : 'FALHA';
console.log(`\nMeta p95 < ${META_MS} ms: ${result['verdict']} (pior p95 = ${worst.toFixed(3)} ms)`);

const out = process.env['BENCH_OUT'] ?? new URL('./resultado.json', import.meta.url).pathname;
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`Resultado escrito em ${out}`);
if (result['verdict'] !== 'OK') process.exitCode = 1;
