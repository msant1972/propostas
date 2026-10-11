import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { verifyChain } from '../src/audit.js';
import { createPrisma } from '../src/index.js';

/**
 * Verifica a integridade de uma instalação (ou de uma restaurada de um backup):
 *  1. a cadeia de hashes da auditoria;
 *  2. o SHA-256 de cada documento registado, comparado com o ficheiro em disco;
 *  3. o snapshot das cotações bloqueadas, comparado com o hash guardado.
 * Uso: pnpm ops:verify [--db <url>] [--storage <pasta>]   (sai com código 1 se algo falhar)
 */
const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const url = opt('--db') ?? process.env['DATABASE_URL'];
const storage = resolve(opt('--storage') ?? process.env['DOCUMENT_STORAGE_DIR'] ?? './storage');
if (!url) throw new Error('DATABASE_URL em falta (ou use --db)');

const prisma = createPrisma(url);
let problems = 0;
const bad = (msg: string) => { problems++; console.error(`  ✗ ${msg}`); };

const chain = await verifyChain(prisma);
console.log(`Auditoria: ${chain.checked} linhas${chain.ok ? ' — cadeia íntegra' : ''}`);
if (!chain.ok) bad(`cadeia quebrada na linha ${chain.brokenAt}: ${chain.reason}`);

const docs = await prisma.document.findMany();
let missing = 0;
for (const d of docs) {
  const file = resolve(storage, d.storageKey);
  if (!file.startsWith(storage + sep)) { bad(`${d.storageKey}: caminho fora do repositório`); continue; }
  try {
    const sha = createHash('sha256').update(await readFile(file)).digest('hex');
    if (sha !== d.sha256) bad(`${d.storageKey}: o hash em disco não corresponde ao registado`);
  } catch {
    missing++;
    bad(`${d.storageKey}: ficheiro em falta`);
  }
}
console.log(`Documentos: ${docs.length} registados, ${docs.length - missing} encontrados`);

const { snapshotHash } = await import('@cpq/rules-engine');
const locked = await prisma.quoteVersion.findMany({ where: { status: { in: ['LOCKED', 'SUPERSEDED'] }, snapshotHash: { not: null } } });
let snapOk = 0;
for (const v of locked) {
  if (snapshotHash(v.snapshotJson) === v.snapshotHash) snapOk++;
  else bad(`cotação ${v.id}: o snapshot não corresponde ao hash guardado`);
}
console.log(`Cotações bloqueadas: ${locked.length}, ${snapOk} com snapshot íntegro`);

await prisma.$disconnect();
console.log(problems === 0 ? 'Integridade verificada: sem problemas.' : `${problems} problema(s) encontrado(s).`);
process.exit(problems === 0 ? 0 : 1);
