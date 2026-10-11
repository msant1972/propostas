import { findPriceListOverlaps, type PriceList as EnginePriceList } from '@cpq/rules-engine';
import { uuidv7 } from '@cpq/shared';
import type { PrismaClient } from '../generated/client.js';
import { normalizeHeader, parseCsv, parseDecimal } from './csv.js';

export type ImportType = 'clients' | 'products' | 'price-list-items';

export interface ImportOptions {
  type: ImportType;
  csv: string;
  delimiter?: string;
  dryRun?: boolean;
  /** Grava as linhas válidas e ignora as inválidas (por omissão, um erro cancela tudo). */
  skipInvalid?: boolean;
  priceList?: string;
  createList?: { currency: string; validFrom: string };
}

export interface ImportError {
  line: number;
  column: string | null;
  message: string;
}

export interface ImportReport {
  type: ImportType;
  dryRun: boolean;
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  errors: ImportError[];
  applied: boolean;
}

/** Nomes aceites para cada coluna (português e inglês), já normalizados. */
const ALIASES: Record<ImportType, Record<string, string[]>> = {
  clients: {
    code: ['codigo', 'code'], name: ['nome', 'name'], vatNumber: ['nif', 'vat', 'vat_number', 'nif_vat'], countryCode: ['pais', 'country', 'country_code'],
    tier: ['tier', 'escalao_cliente'], contactName: ['contacto_nome', 'contact_name'], contactEmail: ['contacto_email', 'contact_email'], crmExternalId: ['id_crm', 'crm_external_id', 'crm_id'],
  },
  products: {
    sku: ['sku', 'referencia'], name: ['nome', 'name'], description: ['descricao', 'description'], unitOfMeasure: ['unidade', 'unit', 'unit_of_measure'],
    billingModel: ['modelo_cobranca', 'billing_model'], billingPeriod: ['periodo', 'billing_period'], unitCost: ['custo', 'unit_cost'],
    costCurrency: ['moeda_custo', 'cost_currency'], taxCategory: ['categoria_fiscal', 'tax_category'], isActive: ['ativo', 'active', 'is_active'],
  },
  'price-list-items': { sku: ['sku', 'referencia'], minQuantity: ['escalao_min_qtd', 'min_quantity', 'qtd_min'], unitPrice: ['preco', 'unit_price', 'price'] },
};

const REQUIRED: Record<ImportType, string[]> = {
  clients: ['code', 'name', 'countryCode'],
  products: ['sku', 'name', 'billingModel'],
  'price-list-items': ['sku', 'unitPrice'],
};

const BILLING: Record<string, 'ONE_TIME' | 'RECURRING' | 'USAGE_BASED' | 'MILESTONE'> = {
  ONE_TIME: 'ONE_TIME', PONTUAL: 'ONE_TIME', RECURRING: 'RECURRING', RECORRENTE: 'RECURRING', USAGE_BASED: 'USAGE_BASED', CONSUMO: 'USAGE_BASED', MILESTONE: 'MILESTONE', MARCOS: 'MILESTONE',
};
const PERIOD: Record<string, 'MONTH' | 'QUARTER' | 'YEAR'> = { MONTH: 'MONTH', MES: 'MONTH', MÊS: 'MONTH', QUARTER: 'QUARTER', TRIMESTRE: 'QUARTER', YEAR: 'YEAR', ANO: 'YEAR' };
const TAX = ['STANDARD', 'REDUCED', 'EXEMPT', 'OUTSIDE_SCOPE'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const truthy = (v: string) => ['1', 'true', 'sim', 's', 'yes', 'y', 'ativo'].includes(v.trim().toLowerCase());
const falsy = (v: string) => ['0', 'false', 'nao', 'não', 'n', 'no', 'inativo'].includes(v.trim().toLowerCase());

interface Parsed<T> { line: number; data: T }

/** Lê o CSV e devolve cada linha com os campos canónicos (ou o erro de cabeçalho). */
function readRows(opts: ImportOptions): { rows: Array<{ line: number; raw: Record<string, string> }>; errors: ImportError[] } {
  const table = parseCsv(opts.csv, opts.delimiter);
  if (table.length === 0) return { rows: [], errors: [{ line: 1, column: null, message: 'O ficheiro está vazio' }] };
  const headers = table[0]!.map(normalizeHeader);
  const index = new Map<string, number>();
  for (const [field, names] of Object.entries(ALIASES[opts.type])) {
    const i = headers.findIndex((h) => names.includes(h));
    if (i >= 0) index.set(field, i);
  }
  const errors: ImportError[] = [];
  for (const f of REQUIRED[opts.type]) {
    if (!index.has(f)) errors.push({ line: 1, column: f, message: `Falta a coluna obrigatória (${ALIASES[opts.type][f]!.join(' | ')})` });
  }
  const rows = table.slice(1).map((cells, n) => ({
    line: n + 2,
    raw: Object.fromEntries([...index].map(([f, i]) => [f, (cells[i] ?? '').trim()])),
  }));
  return { rows, errors };
}

function validateClient(r: Record<string, string>, line: number, errors: ImportError[]) {
  const err = (column: string, message: string) => errors.push({ line, column, message });
  if (!r['code']) err('code', 'Código em falta');
  else if (r['code'].length > 50) err('code', 'Código com mais de 50 caracteres');
  if (!r['name']) err('name', 'Nome em falta');
  const country = (r['countryCode'] ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) err('countryCode', 'País tem de ter 2 letras (ISO 3166-1), ex.: PT');
  if (r['contactEmail'] && !EMAIL.test(r['contactEmail'])) err('contactEmail', 'Email inválido');
  return { code: r['code'] ?? '', name: r['name'] ?? '', countryCode: country, vatNumber: r['vatNumber'] || null, tier: r['tier'] || null, contactName: r['contactName'] || null, contactEmail: r['contactEmail']?.toLowerCase() || null, crmExternalId: r['crmExternalId'] || null };
}

function validateProduct(r: Record<string, string>, line: number, errors: ImportError[]) {
  const err = (column: string, message: string) => errors.push({ line, column, message });
  if (!r['sku']) err('sku', 'SKU em falta');
  else if (r['sku'].length > 50) err('sku', 'SKU com mais de 50 caracteres');
  if (!r['name']) err('name', 'Nome em falta');
  const model = BILLING[(r['billingModel'] ?? '').toUpperCase()];
  if (!model) err('billingModel', 'Modelo de cobrança inválido (PONTUAL, RECORRENTE, CONSUMO ou MARCOS)');
  const period = r['billingPeriod'] ? PERIOD[r['billingPeriod'].toUpperCase()] : undefined;
  if (r['billingPeriod'] && !period) err('billingPeriod', 'Período inválido (MES, TRIMESTRE ou ANO)');
  if (model === 'RECURRING' && !period) err('billingPeriod', 'Produtos recorrentes exigem período de cobrança');
  const cost = r['unitCost'] ? parseDecimal(r['unitCost']) : '0';
  if (cost === null || Number(cost) < 0) err('unitCost', 'Custo inválido');
  const currency = (r['costCurrency'] || 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) err('costCurrency', 'Moeda inválida (3 letras, ex.: EUR)');
  const tax = (r['taxCategory'] || 'STANDARD').toUpperCase();
  if (!TAX.includes(tax)) err('taxCategory', `Categoria fiscal inválida (${TAX.join(', ')})`);
  let active = true;
  if (r['isActive']) {
    if (truthy(r['isActive'])) active = true;
    else if (falsy(r['isActive'])) active = false;
    else err('isActive', 'Valor inválido (sim/não)');
  }
  return { sku: r['sku'] ?? '', name: r['name'] ?? '', description: r['description'] || null, unitOfMeasure: r['unitOfMeasure'] || 'UN', billingModel: model, billingPeriod: model === 'RECURRING' ? period ?? null : period ?? null, unitCost: cost ?? '0', costCurrency: currency, taxCategory: tax, isActive: active };
}

const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');
const num = (v: { toString(): string } | string) => Number(v.toString());

/**
 * Importa um CSV de clientes, produtos ou itens de lista de preços. Valida tudo antes de gravar; se houver erros e
 * não se pediu `skipInvalid`, nada é gravado. É idempotente: o mesmo ficheiro volta a dar "inalterados".
 */
export async function importCsv(prisma: PrismaClient, opts: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = { type: opts.type, dryRun: !!opts.dryRun, rows: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [], applied: false };
  const { rows, errors: headerErrors } = readRows(opts);
  report.rows = rows.length;
  if (headerErrors.length) return { ...report, errors: headerErrors };

  const seen = new Map<string, number>();
  const dupe = (key: string, line: number, column: string) => {
    const first = seen.get(key);
    if (first !== undefined) { report.errors.push({ line, column, message: `Repetido (já aparece na linha ${first})` }); return true; }
    seen.set(key, line);
    return false;
  };

  // 1. validação
  type Plan = { line: number; action: 'create' | 'update' | 'unchanged'; apply: (tx: Pick<PrismaClient, never> & PrismaClient) => Promise<void> };
  const plans: Plan[] = [];
  const invalidLines = new Set<number>();
  const mark = (before: number, line: number) => { if (report.errors.length > before) invalidLines.add(line); };

  if (opts.type === 'clients') {
    const parsed: Array<Parsed<ReturnType<typeof validateClient>>> = [];
    for (const { line, raw } of rows) {
      const before = report.errors.length;
      const data = validateClient(raw, line, report.errors);
      if (data.code) dupe(`c:${data.code}`, line, 'code');
      if (data.crmExternalId) dupe(`x:${data.crmExternalId}`, line, 'crmExternalId');
      mark(before, line);
      parsed.push({ line, data });
    }
    const existing = new Map((await prisma.client.findMany({ where: { code: { in: parsed.map((p) => p.data.code) } } })).map((c) => [c.code, c]));
    for (const { line, data } of parsed) {
      if (invalidLines.has(line)) continue;
      const cur = existing.get(data.code);
      if (!cur) plans.push({ line, action: 'create', apply: async (tx) => { await tx.client.create({ data: { id: uuidv7(), ...data } }); } });
      else {
        const changed = (['name', 'countryCode', 'vatNumber', 'tier', 'contactName', 'contactEmail', 'crmExternalId'] as const).some((k) => !same(cur[k], data[k])) || cur.deletedAt !== null;
        plans.push({ line, action: changed ? 'update' : 'unchanged', apply: async (tx) => { if (changed) await tx.client.update({ where: { id: cur.id }, data: { ...data, deletedAt: null } }); } });
      }
    }
  } else if (opts.type === 'products') {
    const parsed: Array<Parsed<ReturnType<typeof validateProduct>>> = [];
    for (const { line, raw } of rows) {
      const before = report.errors.length;
      const data = validateProduct(raw, line, report.errors);
      if (data.sku) dupe(`p:${data.sku}`, line, 'sku');
      mark(before, line);
      parsed.push({ line, data });
    }
    const existing = new Map((await prisma.product.findMany({ where: { sku: { in: parsed.map((p) => p.data.sku) } } })).map((p) => [p.sku, p]));
    for (const { line, data } of parsed) {
      if (invalidLines.has(line)) continue;
      const clean = { ...data, billingModel: data.billingModel!, billingPeriod: data.billingPeriod ?? null };
      const cur = existing.get(clean.sku);
      if (!cur) plans.push({ line, action: 'create', apply: async (tx) => { await tx.product.create({ data: { id: uuidv7(), ...clean } }); } });
      else {
        const changed = !same(cur.name, clean.name) || !same(cur.description, clean.description) || !same(cur.unitOfMeasure, clean.unitOfMeasure) || cur.billingModel !== clean.billingModel ||
          !same(cur.billingPeriod, clean.billingPeriod) || num(cur.unitCost) !== num(clean.unitCost) || cur.costCurrency !== clean.costCurrency || cur.taxCategory !== clean.taxCategory || cur.isActive !== clean.isActive;
        plans.push({ line, action: changed ? 'update' : 'unchanged', apply: async (tx) => { if (changed) await tx.product.update({ where: { id: cur.id }, data: { ...clean, rowVersion: { increment: 1 } } }); } });
      }
    }
  } else {
    if (!opts.priceList) return { ...report, errors: [{ line: 1, column: null, message: 'Indique a lista de preços (--price-list "Nome")' }] };
    let list = await prisma.priceList.findFirst({ where: { name: opts.priceList }, include: { items: true } });
    if (!list && !opts.createList) return { ...report, errors: [{ line: 1, column: null, message: `A lista "${opts.priceList}" não existe (use --create-list --currency EUR --valid-from AAAA-MM-DD)` }] };
    const create = !list ? opts.createList! : null;
    if (create) {
      if (!/^[A-Z]{3}$/.test(create.currency) || !/^\d{4}-\d{2}-\d{2}$/.test(create.validFrom)) return { ...report, errors: [{ line: 1, column: null, message: 'Moeda ou data de início inválidas para a nova lista' }] };
      const others = await prisma.priceList.findMany();
      const candidate: EnginePriceList = { id: 'nova', name: opts.priceList, currency: create.currency, region: null, channel: null, clientTier: null, validFrom: create.validFrom, validTo: null, items: [] };
      const asEngine = others.map((o): EnginePriceList => ({ id: o.id, name: o.name, currency: o.currency, region: o.region, channel: o.channel, clientTier: o.clientTier, validFrom: o.validFrom.toISOString().slice(0, 10), validTo: o.validTo?.toISOString().slice(0, 10) ?? null, items: [] }));
      const clash = findPriceListOverlaps([candidate, ...asEngine]).find(([a]) => a.id === 'nova');
      if (clash) return { ...report, errors: [{ line: 1, column: null, message: `A nova lista sobrepõe-se a "${clash[1].name}" com os mesmos critérios` }] };
    }
    const skus = [...new Set(rows.map((r) => r.raw['sku']).filter((s): s is string => !!s))];
    const products = new Map((await prisma.product.findMany({ where: { sku: { in: skus } } })).map((p) => [p.sku, p]));
    const existing = new Map((list?.items ?? []).map((i) => [`${i.productId}|${num(i.minQuantity)}`, i]));
    const listId = list?.id ?? uuidv7();
    const items: Array<{ line: number; productId: string; min: string; price: string }> = [];
    for (const { line, raw } of rows) {
      const before = report.errors.length;
      const p = products.get(raw['sku'] ?? '');
      if (!raw['sku']) report.errors.push({ line, column: 'sku', message: 'SKU em falta' });
      else if (!p) report.errors.push({ line, column: 'sku', message: `Produto inexistente: ${raw['sku']}` });
      const min = raw['minQuantity'] ? parseDecimal(raw['minQuantity']) : '0';
      if (min === null || Number(min) < 0) report.errors.push({ line, column: 'minQuantity', message: 'Escalão (quantidade mínima) inválido' });
      const price = parseDecimal(raw['unitPrice'] ?? '');
      if (price === null || Number(price) < 0) report.errors.push({ line, column: 'unitPrice', message: 'Preço inválido' });
      if (p && min !== null) dupe(`i:${p.id}|${Number(min)}`, line, 'sku');
      mark(before, line);
      if (!invalidLines.has(line) && p) items.push({ line, productId: p.id, min: min!, price: price! });
    }
    if (create) {
      plans.push({ line: 1, action: 'create', apply: async (tx) => { await tx.priceList.create({ data: { id: listId, name: opts.priceList!, currency: create.currency, validFrom: new Date(create.validFrom) } }); } });
      report.created += 0;
    }
    for (const it of items) {
      const cur = existing.get(`${it.productId}|${Number(it.min)}`);
      if (!cur) plans.push({ line: it.line, action: 'create', apply: async (tx) => { await tx.priceListItem.create({ data: { id: uuidv7(), priceListId: listId, productId: it.productId, minQuantity: it.min, unitPrice: it.price } }); } });
      else {
        const changed = num(cur.unitPrice) !== num(it.price);
        plans.push({ line: it.line, action: changed ? 'update' : 'unchanged', apply: async (tx) => { if (changed) await tx.priceListItem.update({ where: { id: cur.id }, data: { unitPrice: it.price } }); } });
      }
    }
    list = null;
  }

  report.skipped = invalidLines.size;
  if (report.errors.length > 0 && !opts.skipInvalid) return report; // nada é gravado

  const itemPlans = plans.filter((p) => !(opts.type === 'price-list-items' && p.line === 1));
  for (const p of itemPlans) report[p.action === 'create' ? 'created' : p.action === 'update' ? 'updated' : 'unchanged']++;
  if (opts.dryRun) return report;

  await prisma.$transaction(async (tx) => {
    for (const p of plans) await p.apply(tx as PrismaClient);
  }, { timeout: 120_000 });
  report.applied = true;
  return report;
}
