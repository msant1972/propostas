// Escreve out/perf-report.json e out/perf-report.md.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fmt } from './lib.mjs';

export function writeReports(dir, report) {
  writeFileSync(path.join(dir, 'perf-report.json'), JSON.stringify(report, null, 2));
  const L = [];
  const m = report.machine;
  L.push('# Relatório de carga', '', ...(report.restarts?.length ? [`AVISO: processos reiniciados durante o teste (resultados afetados): ${report.restarts.join('; ')}`, ''] : []), `Gerado em ${m.date}${report.quick ? ' (modo rápido: volumes reduzidos)' : ''}.`, '');
  L.push(`Máquina: ${m.cpu} (${m.cores} threads), ${m.ramGiB} GiB RAM, ${m.platform}, Node ${m.node}.`);
  L.push(`Dados: ${report.dataset.products} produtos, ${report.dataset.priceListItems} itens de preço, ${report.dataset.rules} regras, ${report.dataset.sections} secções por proposta.`, '');
  for (const s of report.scenarios) {
    L.push(`## ${s.title}`, '', `Objetivo: ${s.goal}.`, '');
    L.push('| Teste | Pedidos | Erros | p50 ms | p95 ms | p99 ms | máx ms | req/s | Meta |', '|---|---:|---:|---:|---:|---:|---:|---:|:--:|');
    for (const r of s.rows) {
      L.push(`| ${r.label} | ${r.requests ?? r.n} | ${r.errors} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmt(r.max)} | ${fmt(r.rps)} | ${r.verdict}${r.note ? ` (${r.note})` : ''} |`);
    }
    if (s.extra) L.push('', `Extra: ${JSON.stringify(s.extra)}`);
    if (s.resources) {
      L.push('', 'Recursos durante o cenário (CPU em % de um core; RSS máximo):', '');
      for (const [k, v] of Object.entries(s.resources)) L.push(`- ${k}: CPU média ${fmt(v.cpuAvg, 0)} %, pico ${fmt(v.cpuMax, 0)} %, RSS máx ${fmt(v.rssMaxMiB, 0)} MiB`);
    }
    L.push('');
  }
  writeFileSync(path.join(dir, 'perf-report.md'), L.join('\n'));
}
