export type ISODate = string; // YYYY-MM-DD

export type BillingModel = 'ONE_TIME' | 'RECURRING' | 'USAGE_BASED' | 'MILESTONE';
export type BillingPeriod = 'MONTH' | 'QUARTER' | 'YEAR';
export type TaxCategory = 'STANDARD' | 'REDUCED' | 'EXEMPT' | 'OUTSIDE_SCOPE';
export type TaxRegime = 'STANDARD' | 'REDUCED' | 'EXEMPT' | 'REVERSE_CHARGE' | 'OUTSIDE_SCOPE';

export type AttributeType = 'INTEGER' | 'DECIMAL' | 'LIST' | 'BOOLEAN';
export type AttributeValue = string | number | boolean;

export interface ProductAttribute {
  code: string;
  type: AttributeType;
  min?: number;
  max?: number;
  step?: number;
  allowedValues?: string[];
  required?: boolean;
  defaultValue?: AttributeValue;
}

export interface BundleComponent {
  componentProductId: string;
  required: boolean;
  defaultQuantity: string;
  minQuantity?: string;
  maxQuantity?: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  billingModel: BillingModel;
  billingPeriod: BillingPeriod | null;
  unitCost: string;
  costCurrency: string;
  taxCategory: TaxCategory;
  attributes?: ProductAttribute[];
  bundle?: BundleComponent[];
}

export interface PriceListItem {
  productId: string;
  minQuantity: string;
  unitPrice: string;
}

export interface PriceList {
  id: string;
  name: string;
  currency: string;
  region: string | null;
  channel: string | null;
  clientTier: string | null;
  validFrom: ISODate;
  validTo: ISODate | null;
  items: PriceListItem[];
}

export interface TaxRate {
  countryCode: string;
  taxCategory: TaxCategory;
  regime: TaxRegime;
  ratePercent: string;
  validFrom: ISODate;
  validTo: ISODate | null;
}

export interface FxRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: string;
  rateDate: ISODate;
}

export interface ClientContext {
  countryCode: string;
  tier: string | null;
  region: string | null;
  isBusiness: boolean;
  /** VAT intracomunitário validado (VIES). */
  vatValid: boolean;
}

export interface QuoteLineInput {
  productId: string;
  quantity: string;
  termMonths?: number;
  discountPercent?: string;
  attributes?: Record<string, AttributeValue>;
}

export interface QuoteInput {
  date: ISODate;
  currency: string;
  channel: string | null;
  issuerCountry: string;
  client: ClientContext;
  globalDiscountPercent?: string;
  lines: QuoteLineInput[];
}

export interface Catalog {
  products: Product[];
  priceLists: PriceList[];
  taxRates: TaxRate[];
  fxRates: FxRate[];
  rules: CpqRule[];
}

export type RuleType = 'REQUIRES' | 'EXCLUDES' | 'RECOMMENDS' | 'CONSTRAINT' | 'DEFAULT';

export interface CpqRule {
  id: string;
  sourceProductId: string;
  targetProductId: string | null;
  type: RuleType;
  /** JSONLogic; null = sempre. Variáveis: source.*, target.*, quote.*, client.* (ver evaluate.ts). */
  condition: unknown | null;
  /** CONSTRAINT: { field: 'quantity' | 'attribute:<code>', min?, max?, step? }; DEFAULT: { attribute, value }; REQUIRES: { targetMinQuantity? }. */
  params?: Record<string, unknown>;
  priority: number;
  message: string | null;
  validFrom: ISODate;
  validTo: ISODate | null;
  isActive: boolean;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Violation {
  ruleId: string | null;
  code: string;
  severity: Severity;
  lineNumber: number | null;
  productId: string | null;
  targetProductId?: string | null;
  message: string;
}

export interface QuoteLineResult {
  lineNumber: number;
  productId: string;
  quantity: string;
  priceListId: string;
  listUnitPrice: string;
  discountPercent: string;
  netUnitPrice: string;
  /** valor da linha por período, depois do desconto de linha */
  lineValue: string;
  globalDiscountAmount: string;
  /** valor sem imposto = lineValue − globalDiscountAmount (é o `line_total` da BD) */
  lineTotal: string;
  unitCost: string;
  costFxRate: string;
  taxRegime: TaxRegime;
  taxRatePercent: string;
  taxAmount: string;
  /** valor total da linha ao longo da duração do contrato (sem imposto) */
  lineTcv: string;
  lineCostTcv: string;
  marginPercent: string | null;
}

export interface QuoteTotals {
  subtotal: string;
  discountAmount: string;
  totalTax: string;
  grandTotal: string;
  oneTime: string;
  mrr: string;
  arr: string;
  usage: string;
  milestones: string;
  tcv: string;
  marginPercent: string | null;
}

export interface QuoteResult {
  currency: string;
  priceListId: string;
  lines: QuoteLineResult[];
  totals: QuoteTotals;
  violations: Violation[];
  defaults: Array<{ lineNumber: number; attribute: string; value: AttributeValue }>;
  valid: boolean;
}
