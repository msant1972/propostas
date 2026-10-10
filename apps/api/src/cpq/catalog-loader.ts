import { Inject, Injectable } from '@nestjs/common';
import type { Catalog, CpqRule, PriceList, Product, TaxCategory } from '@cpq/rules-engine';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const dec = (d: { toString(): string }) => d.toString();

/**
 * Carrega o catálogo completo (produtos, listas de preços, impostos, câmbios, regras) no formato do
 * `@cpq/rules-engine`. Cache em memória de curta duração; as escritas administrativas invalidam-no.
 * (A cache partilhada em Redis, tarefa 2.15, substitui isto quando houver mais do que uma instância da API.)
 */
@Injectable()
export class CatalogLoader {
  private cached?: { at: number; catalog: Catalog };
  private static readonly TTL_MS = 30_000;

  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  invalidate(): void {
    this.cached = undefined;
  }

  async load(): Promise<Catalog> {
    if (this.cached && Date.now() - this.cached.at < CatalogLoader.TTL_MS) return this.cached.catalog;

    const [products, attributes, bundles, priceLists, taxRates, fxRates, rules] = await Promise.all([
      this.prisma.product.findMany(),
      this.prisma.productAttribute.findMany(),
      this.prisma.productBundleItem.findMany(),
      this.prisma.priceList.findMany({ include: { items: true } }),
      this.prisma.taxRate.findMany(),
      this.prisma.fxRate.findMany(),
      this.prisma.cpqRule.findMany({ where: { isActive: true } }),
    ]);

    const catalog: Catalog = {
      products: products.map<Product>((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        billingModel: p.billingModel,
        billingPeriod: p.billingPeriod,
        unitCost: dec(p.unitCost),
        costCurrency: p.costCurrency,
        taxCategory: p.taxCategory as TaxCategory,
        attributes: attributes
          .filter((a) => a.productId === p.id)
          .map((a) => ({
            code: a.code,
            type: a.dataType,
            min: a.minValue ? Number(a.minValue) : undefined,
            max: a.maxValue ? Number(a.maxValue) : undefined,
            step: a.stepValue ? Number(a.stepValue) : undefined,
            allowedValues: (a.allowedValuesJson as string[] | null) ?? undefined,
            required: a.isRequired,
            defaultValue: a.defaultValue ?? undefined,
          })),
        bundle: bundles
          .filter((b) => b.bundleProductId === p.id)
          .map((b) => ({
            componentProductId: b.componentProductId,
            required: b.isRequired,
            defaultQuantity: dec(b.defaultQuantity),
            minQuantity: b.minQuantity ? dec(b.minQuantity) : undefined,
            maxQuantity: b.maxQuantity ? dec(b.maxQuantity) : undefined,
          })),
      })),
      priceLists: priceLists.map<PriceList>((l) => ({
        id: l.id,
        name: l.name,
        currency: l.currency,
        region: l.region,
        channel: l.channel,
        clientTier: l.clientTier,
        validFrom: day(l.validFrom)!,
        validTo: day(l.validTo),
        items: l.items.map((i) => ({ productId: i.productId, minQuantity: dec(i.minQuantity), unitPrice: dec(i.unitPrice) })),
      })),
      taxRates: taxRates.map((t) => ({
        countryCode: t.countryCode,
        taxCategory: t.taxCategory as TaxCategory,
        regime: t.regime,
        ratePercent: dec(t.ratePercent),
        validFrom: day(t.validFrom)!,
        validTo: day(t.validTo),
      })),
      fxRates: fxRates.map((f) => ({
        baseCurrency: f.baseCurrency,
        quoteCurrency: f.quoteCurrency,
        rate: dec(f.rate),
        rateDate: day(f.rateDate)!,
      })),
      rules: rules.map<CpqRule>((r) => ({
        id: r.id,
        sourceProductId: r.sourceProductId,
        targetProductId: r.targetProductId,
        type: r.ruleType,
        condition: r.conditionJson ?? null,
        params: (r.paramsJson as Record<string, unknown> | null) ?? undefined,
        priority: r.priority,
        message: r.message,
        validFrom: day(r.validFrom)!,
        validTo: day(r.validTo),
        isActive: r.isActive,
      })),
    };
    this.cached = { at: Date.now(), catalog };
    return catalog;
  }
}
