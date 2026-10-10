import type { Catalog, ClientContext, CpqRule, Product, QuoteInput } from './types.js';

export const product = (over: Partial<Product> & Pick<Product, 'id' | 'sku'>): Product => ({
  name: over.sku,
  billingModel: 'ONE_TIME',
  billingPeriod: null,
  unitCost: '0',
  costCurrency: 'EUR',
  taxCategory: 'STANDARD',
  ...over,
});

export const rule = (over: Partial<CpqRule> & Pick<CpqRule, 'id' | 'sourceProductId' | 'type'>): CpqRule => ({
  targetProductId: null,
  condition: null,
  priority: 100,
  message: null,
  validFrom: '2026-01-01',
  validTo: null,
  isActive: true,
  ...over,
});

export const ptBusiness: ClientContext = { countryCode: 'PT', tier: null, region: null, isBusiness: true, vatValid: true };

export function baseCatalog(): Catalog {
  return {
    products: [
      product({ id: 'LIC', sku: 'LIC', name: 'Licença', billingModel: 'RECURRING', billingPeriod: 'MONTH', unitCost: '10' }),
      product({ id: 'SUP', sku: 'SUP', name: 'Suporte', billingModel: 'RECURRING', billingPeriod: 'YEAR', unitCost: '100' }),
      product({ id: 'PRM', sku: 'PRM', name: 'Suporte Premium', billingModel: 'RECURRING', billingPeriod: 'MONTH', unitCost: '4' }),
      product({ id: 'IMP', sku: 'IMP', name: 'Implementação', unitCost: '40' }),
      product({ id: 'PEN', sku: 'PEN', name: 'Taxa mínima', unitCost: '0' }),
    ],
    priceLists: [
      {
        id: 'PL-EUR',
        name: 'Geral EUR',
        currency: 'EUR',
        region: null,
        channel: null,
        clientTier: null,
        validFrom: '2026-01-01',
        validTo: null,
        items: [
          { productId: 'LIC', minQuantity: '0', unitPrice: '20.0000' },
          { productId: 'LIC', minQuantity: '50', unitPrice: '18.0000' },
          { productId: 'SUP', minQuantity: '0', unitPrice: '1000.0000' },
          { productId: 'PRM', minQuantity: '0', unitPrice: '9.0000' },
          { productId: 'IMP', minQuantity: '0', unitPrice: '60.0000' },
          { productId: 'PEN', minQuantity: '0', unitPrice: '0.0500' },
        ],
      },
    ],
    taxRates: [
      { countryCode: 'PT', taxCategory: 'STANDARD', regime: 'STANDARD', ratePercent: '23.00', validFrom: '2020-01-01', validTo: null },
      { countryCode: 'PT', taxCategory: 'REDUCED', regime: 'REDUCED', ratePercent: '6.00', validFrom: '2020-01-01', validTo: null },
    ],
    fxRates: [],
    rules: [],
  };
}

export const quote = (over: Partial<QuoteInput> = {}): QuoteInput => ({
  date: '2026-10-10',
  currency: 'EUR',
  channel: null,
  issuerCountry: 'PT',
  client: ptBusiness,
  lines: [],
  ...over,
});
