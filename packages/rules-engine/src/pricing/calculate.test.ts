import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { baseCatalog, product, quote } from '../fixtures.js';
import { calculateQuote } from './calculate.js';
import { D } from '../money.js';

describe('calculateQuote — casos de referência (calculados à mão)', () => {
  it('licença mensal sem descontos: 10 × 20 € durante 12 meses', () => {
    const r = calculateQuote(quote({ lines: [{ productId: 'LIC', quantity: '10', termMonths: 12 }] }), baseCatalog());
    const l = r.lines[0]!;
    expect(l.lineValue).toBe('200.00');
    expect(l.taxAmount).toBe('46.00'); // 23 %
    expect(l.lineTcv).toBe('2400.00'); // 200 × 12
    expect(l.lineCostTcv).toBe('1200.00'); // 10 × 10 × 12
    expect(l.marginPercent).toBe('50.00');
    expect(r.totals).toMatchObject({ subtotal: '200.00', totalTax: '46.00', grandTotal: '246.00', mrr: '200.00', arr: '2400.00', tcv: '2400.00', marginPercent: '50.00' });
    expect(r.valid).toBe(true);
  });

  it('escalão de volume + desconto de linha + desconto global', () => {
    const r = calculateQuote(
      quote({ globalDiscountPercent: '5', lines: [{ productId: 'LIC', quantity: '60', termMonths: 12, discountPercent: '10' }] }),
      baseCatalog(),
    );
    const l = r.lines[0]!;
    expect(l.listUnitPrice).toBe('18.0000'); // escalão ≥ 50
    expect(l.lineValue).toBe('972.00'); // 60 × 18 × 0,9
    expect(l.globalDiscountAmount).toBe('48.60'); // 5 %
    expect(l.lineTotal).toBe('923.40');
    expect(l.taxAmount).toBe('212.38'); // 923,40 × 23 % = 212,382
    expect(l.lineTcv).toBe('11080.80');
    expect(l.marginPercent).toBe('35.02'); // (11080,80 − 7200) / 11080,80
  });

  it('desconto global: o resíduo de arredondamento vai para a maior linha e a soma bate certo', () => {
    // duas linhas de 0,05 €; 50 % → cada parcela 0,025 arredonda a 0,03, mas o total devido é 0,05
    const r = calculateQuote(
      quote({ globalDiscountPercent: '50', lines: [{ productId: 'PEN', quantity: '1' }, { productId: 'PEN', quantity: '1' }] }),
      baseCatalog(),
    );
    expect(r.lines.map((l) => l.globalDiscountAmount)).toEqual(['0.02', '0.03']);
    expect(r.lines.map((l) => l.lineTotal)).toEqual(['0.03', '0.02']);
    expect(r.totals.discountAmount).toBe('0.05');
  });

  it('suporte anual: MRR = valor / 12, ARR = valor anual, TCV pela duração', () => {
    const r = calculateQuote(quote({ lines: [{ productId: 'SUP', quantity: '1', termMonths: 24 }] }), baseCatalog());
    expect(r.totals).toMatchObject({ mrr: '83.33', arr: '1000.00', tcv: '2000.00' });
    expect(r.lines[0]!.lineCostTcv).toBe('200.00'); // 100 € por ano × 2 anos
  });

  it('separa pontual, MRR e total do contrato', () => {
    const r = calculateQuote(
      quote({ lines: [{ productId: 'IMP', quantity: '10' }, { productId: 'LIC', quantity: '5', termMonths: 6 }] }),
      baseCatalog(),
    );
    expect(r.totals).toMatchObject({ oneTime: '600.00', mrr: '100.00', tcv: '1200.00' }); // 600 + 100 × 6
  });

  it('custo noutra moeda é convertido para a moeda da cotação', () => {
    const cat = baseCatalog();
    cat.products.push(product({ id: 'USD', sku: 'USD', unitCost: '10', costCurrency: 'USD' }));
    cat.priceLists[0]!.items.push({ productId: 'USD', minQuantity: '0', unitPrice: '20' });
    cat.fxRates.push({ baseCurrency: 'USD', quoteCurrency: 'EUR', rate: '0.9', rateDate: '2026-10-01' });
    const r = calculateQuote(quote({ lines: [{ productId: 'USD', quantity: '1' }] }), cat);
    expect(r.lines[0]!.unitCost).toBe('9.0000');
    expect(r.lines[0]!.marginPercent).toBe('55.00'); // (20 − 9) / 20
  });

  it('IVA: autoliquidação, fora da UE e consumidor final', () => {
    const line = [{ productId: 'IMP', quantity: '1' }];
    const de = { countryCode: 'DE', tier: null, region: null, isBusiness: true, vatValid: true };
    expect(calculateQuote(quote({ client: de, lines: line }), baseCatalog()).lines[0]).toMatchObject({ taxRegime: 'REVERSE_CHARGE', taxAmount: '0.00' });
    expect(calculateQuote(quote({ client: { ...de, countryCode: 'US' }, lines: line }), baseCatalog()).lines[0]).toMatchObject({ taxRegime: 'OUTSIDE_SCOPE', taxAmount: '0.00' });
    expect(calculateQuote(quote({ client: { ...de, isBusiness: false }, lines: line }), baseCatalog()).lines[0]).toMatchObject({ taxRegime: 'STANDARD', taxAmount: '13.80' });
  });

  it('IVA reduzido por categoria fiscal do produto', () => {
    const cat = baseCatalog();
    cat.products.push(product({ id: 'RED', sku: 'RED', taxCategory: 'REDUCED' }));
    cat.priceLists[0]!.items.push({ productId: 'RED', minQuantity: '0', unitPrice: '100' });
    const r = calculateQuote(quote({ lines: [{ productId: 'RED', quantity: '1' }] }), cat);
    expect(r.lines[0]).toMatchObject({ taxRegime: 'REDUCED', taxRatePercent: '6.00', taxAmount: '6.00' });
  });

  it('entradas inválidas geram violações e deixam a linha de fora', () => {
    const r = calculateQuote(
      quote({
        lines: [
          { productId: 'LIC', quantity: '0', termMonths: 12 },
          { productId: 'XXX', quantity: '1' },
          { productId: 'LIC', quantity: '1' }, // falta duração
          { productId: 'LIC', quantity: '1', termMonths: 12, discountPercent: '101' },
        ],
      }),
      baseCatalog(),
    );
    expect(r.valid).toBe(false);
    expect(r.violations.map((v) => v.code)).toEqual(['INVALID_QUANTITY', 'UNKNOWN_PRODUCT', 'TERM_REQUIRED', 'INVALID_DISCOUNT']);
    expect(r.lines).toHaveLength(0);
  });

  it('produto sem preço na lista dá violação NO_PRICE', () => {
    const cat = baseCatalog();
    cat.products.push(product({ id: 'SEM', sku: 'SEM' }));
    expect(calculateQuote(quote({ lines: [{ productId: 'SEM', quantity: '1' }] }), cat).violations[0]!.code).toBe('NO_PRICE');
  });

  it('a mesma cotação dá sempre o mesmo resultado (determinismo)', () => {
    const q = quote({ globalDiscountPercent: '7.5', lines: [{ productId: 'LIC', quantity: '33', termMonths: 18, discountPercent: '3' }, { productId: 'IMP', quantity: '7.5' }] });
    expect(calculateQuote(q, baseCatalog())).toEqual(calculateQuote(q, baseCatalog()));
  });
});

describe('calculateQuote — propriedades', () => {
  const lineArb = fc.record({
    productId: fc.constantFrom('LIC', 'SUP', 'IMP', 'PEN', 'PRM'),
    quantity: fc.integer({ min: 1, max: 500 }).map(String),
    termMonths: fc.integer({ min: 1, max: 60 }),
    discountPercent: fc.integer({ min: 0, max: 100 }).map(String),
  });

  it('totais coerentes: grandTotal = subtotal − desconto + impostos; desconto global = round2(subtotal × %)', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 1, maxLength: 12 }), fc.integer({ min: 0, max: 100 }), (lines, g) => {
        const r = calculateQuote(quote({ globalDiscountPercent: String(g), lines }), baseCatalog());
        const t = r.totals;
        expect(new D(t.subtotal).minus(t.discountAmount).plus(t.totalTax).toFixed(2)).toBe(t.grandTotal);
        expect(t.discountAmount).toBe(new D(t.subtotal).times(g).div(100).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2));
        const lineSum = r.lines.reduce((s, l) => s.plus(l.lineTotal), new D(0));
        expect(lineSum.toFixed(2)).toBe(new D(t.subtotal).minus(t.discountAmount).toFixed(2));
        for (const l of r.lines) expect(new D(l.lineTotal).gte(0)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('a ordem das linhas não altera os totais', () => {
    fc.assert(
      fc.property(fc.array(lineArb, { minLength: 2, maxLength: 8 }), fc.integer({ min: 0, max: 100 }), (lines, g) => {
        const a = calculateQuote(quote({ globalDiscountPercent: String(g), lines }), baseCatalog()).totals;
        const b = calculateQuote(quote({ globalDiscountPercent: String(g), lines: [...lines].reverse() }), baseCatalog()).totals;
        expect(b.subtotal).toBe(a.subtotal);
        expect(b.discountAmount).toBe(a.discountAmount);
        expect(b.tcv).toBe(a.tcv);
      }),
      { numRuns: 200 },
    );
  });
});
