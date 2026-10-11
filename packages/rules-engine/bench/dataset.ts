// Catálogo e cotações sintéticos para o micro-benchmark: 200 produtos, 3 escalões por produto,
// atributos, regras JSONLogic de todos os tipos e IVA normal/reduzido.
import { baseCatalog, product, ptBusiness, rule } from '../dist/fixtures.js';
import type { AttributeValue, Catalog, CpqRule, Product, QuoteInput, QuoteLineInput } from '../dist/index.js';

export const PRODUCT_COUNT = 200;
const pid = (i: number) => `P${String(i).padStart(3, '0')}`;

export function benchCatalog(): Catalog {
  const cat = baseCatalog();
  const products: Product[] = [];
  const items: Catalog['priceLists'][number]['items'] = [];
  const rules: CpqRule[] = [];

  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const kind = i % 4;
    products.push(
      product({
        id: pid(i),
        sku: pid(i),
        name: `Produto ${i}`,
        billingModel: kind <= 1 ? 'RECURRING' : 'ONE_TIME',
        billingPeriod: kind === 0 ? 'MONTH' : kind === 1 ? 'YEAR' : null,
        unitCost: String(5 + (i % 17)),
        taxCategory: kind === 3 ? 'REDUCED' : 'STANDARD',
        attributes:
          i % 5 === 0
            ? [
                { code: 'sites', type: 'INTEGER', min: 1, max: 500, required: true },
                { code: 'regiao', type: 'LIST', allowedValues: ['PT', 'ES', 'FR'], required: true },
              ]
            : undefined,
      }),
    );
    for (const [min, price] of [['0', 100 + i], ['10', 90 + i], ['50', 80 + i]] as const) {
      items.push({ productId: pid(i), minQuantity: min, unitPrice: `${price}.0000` });
    }
    // Regras: restrição de quantidade em todos, REQUIRES / RECOMMENDS / EXCLUDES / DEFAULT em subconjuntos.
    rules.push(
      rule({
        id: `c${i}`, sourceProductId: pid(i), type: 'CONSTRAINT', params: { field: 'quantity', min: 1, max: 10000 },
        condition: { and: [{ '>': [{ var: 'source.quantity' }, 0] }, { '==': [{ var: 'client.isBusiness' }, true] }] },
      }),
    );
    if (i % 3 === 0 && i > 0) {
      rules.push(
        rule({
          id: `r${i}`, sourceProductId: pid(i), targetProductId: pid(i - 1), type: 'REQUIRES',
          condition: { or: [{ '>=': [{ var: 'source.quantity' }, 5] }, { in: [{ var: 'client.countryCode' }, ['PT', 'ES']] }] },
        }),
      );
    }
    if (i % 7 === 0 && i + 1 < PRODUCT_COUNT) {
      rules.push(rule({ id: `s${i}`, sourceProductId: pid(i), targetProductId: pid(i + 1), type: 'RECOMMENDS', condition: { '>': [{ var: 'quote.lineCount' }, 3] } }));
    }
    if (i % 11 === 0) {
      rules.push(rule({ id: `x${i}`, sourceProductId: pid(i), targetProductId: 'X-AUSENTE', type: 'EXCLUDES' }));
      rules.push(rule({ id: `d${i}`, sourceProductId: pid(i), type: 'DEFAULT', params: { attribute: 'regiao', value: 'PT' } }));
    }
  }

  cat.products = products;
  cat.priceLists[0]!.items = items;
  cat.rules = rules;
  return cat;
}

/** Cotação válida de `n` linhas (n ≤ 200): quantidades com escalões, descontos, prazos, atributos e desconto global. */
export function benchQuote(n: number): QuoteInput {
  const lines: QuoteLineInput[] = [];
  for (let i = 0; i < n; i++) {
    const attributes: Record<string, AttributeValue> | undefined = i % 5 === 0 ? { sites: 1 + (i % 50), regiao: 'PT' } : undefined;
    lines.push({
      productId: pid(i),
      quantity: String(1 + ((i * 7) % 120)),
      termMonths: i % 4 <= 1 ? [12, 24, 36][i % 3] : undefined,
      discountPercent: i % 3 === 0 ? String(5 + (i % 10)) : '0',
      attributes,
    });
  }
  return { date: '2026-10-10', currency: 'EUR', channel: null, issuerCountry: 'PT', client: ptBusiness, globalDiscountPercent: '3', lines };
}
