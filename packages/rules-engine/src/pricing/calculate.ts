import { ConfigurationError } from '../errors.js';
import { D, money, price4, round2 } from '../money.js';
import { evaluateRules } from '../rules/evaluate.js';
import type {
  BillingPeriod,
  Catalog,
  Product,
  QuoteInput,
  QuoteLineResult,
  QuoteResult,
  QuoteTotals,
  Violation,
} from '../types.js';
import { fxRate } from './fx.js';
import { selectPriceList } from './price-list.js';
import { applicableTax } from './tax.js';

const MONTHS: Record<BillingPeriod, number> = { MONTH: 1, QUARTER: 3, YEAR: 12 };

interface Working {
  index: number;
  product: Product;
  qty: D;
  lineValue: D;
  priceListItemPrice: D;
  discount: D;
}

/**
 * Cálculo de cotação, pela ordem documentada em Arquitetura.md:
 * lista de preços → escalão → desconto de linha → desconto global (repartido) → arredondamento
 * por linha → IVA por linha → totais por modelo de cobrança → margem.
 * Função pura: o mesmo código corre no browser (pré-visualização) e no servidor (fonte de verdade).
 */
export function calculateQuote(input: QuoteInput, catalog: Catalog): QuoteResult {
  const violations: Violation[] = [];
  const err = (code: string, message: string, lineNumber: number | null, productId: string | null) =>
    violations.push({ ruleId: null, code, severity: 'error', lineNumber, productId, message });

  const priceList = selectPriceList(catalog.priceLists, {
    date: input.date,
    currency: input.currency,
    region: input.client.region,
    channel: input.channel,
    clientTier: input.client.tier,
  });
  const products = new Map(catalog.products.map((p) => [p.id, p]));

  // 1–3. Preço de lista, escalão e desconto de linha.
  const working: Working[] = [];
  input.lines.forEach((line, index) => {
    const n = index + 1;
    const product = products.get(line.productId);
    if (!product) return err('UNKNOWN_PRODUCT', 'Produto desconhecido', n, line.productId);

    const qty = new D(line.quantity);
    if (!qty.isFinite() || qty.lte(0)) return err('INVALID_QUANTITY', 'A quantidade tem de ser positiva', n, product.id);
    const discount = new D(line.discountPercent ?? 0);
    if (discount.lt(0) || discount.gt(100)) return err('INVALID_DISCOUNT', 'O desconto tem de estar entre 0 e 100', n, product.id);
    if (product.billingModel === 'RECURRING' && !(line.termMonths && line.termMonths > 0)) {
      return err('TERM_REQUIRED', 'Indique a duração em meses', n, product.id);
    }

    const tier = priceList.items
      .filter((i) => i.productId === product.id && new D(i.minQuantity).lte(qty))
      .sort((a, b) => new D(b.minQuantity).cmp(a.minQuantity))[0];
    if (!tier) return err('NO_PRICE', `Sem preço para "${product.name}" na lista "${priceList.name}"`, n, product.id);

    const unit = new D(tier.unitPrice);
    working.push({
      index,
      product,
      qty,
      discount,
      priceListItemPrice: unit,
      lineValue: round2(qty.times(unit).times(new D(100).minus(discount).div(100))),
    });
  });

  // 4. Desconto global (%), repartido por linha; o resíduo de arredondamento vai para a maior linha.
  const globalPct = new D(input.globalDiscountPercent ?? 0);
  if (globalPct.lt(0) || globalPct.gt(100)) err('INVALID_DISCOUNT', 'O desconto global tem de estar entre 0 e 100', null, null);
  const pct = globalPct.gte(0) && globalPct.lte(100) ? globalPct : new D(0);

  const subtotal = working.reduce((s, w) => s.plus(w.lineValue), new D(0));
  const shares = working.map((w) => round2(w.lineValue.times(pct).div(100)));
  const residual = round2(subtotal.times(pct).div(100)).minus(shares.reduce((s, x) => s.plus(x), new D(0)));
  if (!residual.isZero() && working.length > 0) {
    let big = 0;
    working.forEach((w, i) => {
      if (w.lineValue.gt(working[big]!.lineValue)) big = i;
    });
    shares[big] = shares[big]!.plus(residual);
  }

  // 5–8. Impostos, TCV e margem por linha.
  const lines: QuoteLineResult[] = working.map((w, i) => {
    const p = w.product;
    const lineTotal = w.lineValue.minus(shares[i]!);

    const tax = applicableTax(catalog.taxRates, input.issuerCountry, input.client, p.taxCategory, input.date);
    const taxAmount = round2(lineTotal.times(tax.ratePercent).div(100));

    const costFx = fxRate(catalog.fxRates, p.costCurrency, input.currency, input.date);
    const unitCost = new D(p.unitCost).times(costFx);

    const term = input.lines[w.index]!.termMonths ?? 0;
    const periods =
      p.billingModel === 'RECURRING' && p.billingPeriod ? new D(term).div(MONTHS[p.billingPeriod]) : new D(1);
    const lineTcv = round2(lineTotal.times(periods));
    const lineCostTcv = round2(w.qty.times(unitCost).times(periods));

    return {
      lineNumber: w.index + 1,
      productId: p.id,
      quantity: w.qty.toString(),
      priceListId: priceList.id,
      listUnitPrice: price4(w.priceListItemPrice),
      discountPercent: w.discount.toFixed(2),
      netUnitPrice: price4(w.priceListItemPrice.times(new D(100).minus(w.discount)).div(100)),
      lineValue: money(w.lineValue),
      globalDiscountAmount: money(shares[i]!),
      lineTotal: money(lineTotal),
      unitCost: price4(unitCost),
      costFxRate: new D(costFx).toDecimalPlaces(8).toFixed(8),
      taxRegime: tax.regime,
      taxRatePercent: new D(tax.ratePercent).toFixed(2),
      taxAmount: money(taxAmount),
      lineTcv: money(lineTcv),
      lineCostTcv: money(lineCostTcv),
      marginPercent: lineTcv.gt(0) ? round2(lineTcv.minus(lineCostTcv).div(lineTcv).times(100)).toFixed(2) : null,
    };
  });

  const sum = (f: (l: QuoteLineResult, p: Product) => D | null) =>
    lines.reduce((s, l, i) => s.plus(f(l, working[i]!.product) ?? 0), new D(0));

  const discountAmount = sum((l) => new D(l.globalDiscountAmount));
  const totalTax = sum((l) => new D(l.taxAmount));
  const tcv = sum((l) => new D(l.lineTcv));
  const costTcv = sum((l) => new D(l.lineCostTcv));
  const mrr = sum((l, p) =>
    p.billingModel === 'RECURRING' && p.billingPeriod ? new D(l.lineTotal).div(MONTHS[p.billingPeriod]) : null,
  );

  const totals: QuoteTotals = {
    subtotal: money(subtotal),
    discountAmount: money(discountAmount),
    totalTax: money(totalTax),
    grandTotal: money(subtotal.minus(discountAmount).plus(totalTax)),
    oneTime: money(sum((l, p) => (p.billingModel === 'ONE_TIME' ? new D(l.lineTotal) : null))),
    mrr: money(mrr),
    arr: money(mrr.times(12)),
    usage: money(sum((l, p) => (p.billingModel === 'USAGE_BASED' ? new D(l.lineTotal) : null))),
    milestones: money(sum((l, p) => (p.billingModel === 'MILESTONE' ? new D(l.lineTotal) : null))),
    tcv: money(tcv),
    marginPercent: tcv.gt(0) ? round2(tcv.minus(costTcv).div(tcv).times(100)).toFixed(2) : null,
  };

  // Regras CPQ, atributos e bundles.
  const evaluated = evaluateRules(input, catalog);
  violations.push(...evaluated.violations);

  return {
    currency: input.currency,
    priceListId: priceList.id,
    lines,
    totals,
    violations,
    defaults: evaluated.defaults,
    valid: !violations.some((v) => v.severity === 'error'),
  };
}

export { ConfigurationError };
