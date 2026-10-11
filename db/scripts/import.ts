import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createPrisma } from '../src/index.js';
import { importCsv, type ImportType } from '../src/import/import.js';

/**
 * Importa um CSV para a base de dados (migração inicial).
 * Uso: pnpm --filter @cpq/db run import -- <clients|products|price-list-items> <ficheiro.csv>
 *        [--dry-run] [--skip-invalid] [--delimiter ;] [--report relatorio.json]
 *        [--price-list "Nome" [--create-list --currency EUR --valid-from AAAA-MM-DD]]
 */
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const positional = args.filter((a, i) => !a.startsWith('--') && !['--delimiter', '--report', '--price-list', '--currency', '--valid-from'].includes(args[i - 1] ?? ''));
const [type, file] = positional;

if (!['clients', 'products', 'price-list-items'].includes(type ?? '') || !file) {
  console.error('Uso: import <clients|products|price-list-items> <ficheiro.csv> [--dry-run] [--skip-invalid] [--delimiter ;] [--report ficheiro.json] [--price-list "Nome" [--create-list --currency EUR --valid-from AAAA-MM-DD]]');
  process.exit(2);
}
// O pnpm executa dentro da pasta do pacote: os caminhos relativos contam a partir de onde o comando foi dado.
const here = process.env['INIT_CWD'] ?? process.cwd();
const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL em falta');

const prisma = createPrisma(url);
const report = await importCsv(prisma, {
  type: type as ImportType,
  csv: await readFile(resolve(here, file), 'utf8'),
  delimiter: opt('--delimiter'),
  dryRun: flag('--dry-run'),
  skipInvalid: flag('--skip-invalid'),
  priceList: opt('--price-list'),
  createList: flag('--create-list') ? { currency: (opt('--currency') ?? 'EUR').toUpperCase(), validFrom: opt('--valid-from') ?? '' } : undefined,
});
await prisma.$disconnect();

const mode = report.dryRun ? ' (simulação: nada foi gravado)' : report.applied ? '' : ' (nada foi gravado)';
console.log(`Importação de ${report.type}${mode}`);
console.log(`  linhas: ${report.rows}  criadas: ${report.created}  atualizadas: ${report.updated}  inalteradas: ${report.unchanged}  ignoradas: ${report.skipped}`);
for (const e of report.errors) console.error(`  ✗ linha ${e.line}${e.column ? `, coluna ${e.column}` : ''}: ${e.message}`);
const report_file = opt('--report');
if (report_file) await writeFile(resolve(here, report_file), JSON.stringify(report, null, 2));
process.exit(report.errors.length > 0 && !flag('--skip-invalid') ? 1 : 0);
