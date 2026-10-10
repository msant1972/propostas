import jsonLogic from 'json-logic-js';
import { D } from '../money.js';
import type {
  AttributeValue,
  Catalog,
  CpqRule,
  Product,
  ProductAttribute,
  QuoteInput,
  QuoteLineInput,
  Violation,
} from '../types.js';

export interface RuleEvaluation {
  violations: Violation[];
  defaults: Array<{ lineNumber: number; attribute: string; value: AttributeValue }>;
}

const active = (r: CpqRule, date: string) =>
  r.isActive && r.validFrom <= date && (r.validTo === null || r.validTo >= date);

const num = (s: string | undefined) => (s === undefined ? 0 : Number(s));

function truthy(condition: unknown | null, data: unknown): boolean {
  if (condition === null || condition === undefined) return true;
  return Boolean(jsonLogic.apply(condition as never, data as never));
}

function validateAttribute(attr: ProductAttribute, value: AttributeValue | undefined): string | null {
  if (value === undefined || value === '') return attr.required ? `O atributo "${attr.code}" é obrigatório` : null;
  switch (attr.type) {
    case 'BOOLEAN':
      return typeof value === 'boolean' ? null : `"${attr.code}" tem de ser verdadeiro/falso`;
    case 'LIST':
      return attr.allowedValues?.includes(String(value)) ? null : `"${attr.code}" tem um valor não permitido`;
    case 'INTEGER':
    case 'DECIMAL': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return `"${attr.code}" tem de ser numérico`;
      if (attr.type === 'INTEGER' && !Number.isInteger(value)) return `"${attr.code}" tem de ser inteiro`;
      if (attr.min !== undefined && value < attr.min) return `"${attr.code}" é inferior ao mínimo (${attr.min})`;
      if (attr.max !== undefined && value > attr.max) return `"${attr.code}" excede o máximo (${attr.max})`;
      if (attr.step) {
        const rest = new D(value).minus(attr.min ?? 0).mod(attr.step);
        if (!rest.isZero()) return `"${attr.code}" tem de avançar em múltiplos de ${attr.step}`;
      }
      return null;
    }
  }
}

/** Valida atributos, bundles e regras CPQ de uma cotação. Não calcula preços. */
export function evaluateRules(input: QuoteInput, catalog: Catalog): RuleEvaluation {
  const violations: Violation[] = [];
  const defaults: RuleEvaluation['defaults'] = [];
  const products = new Map<string, Product>(catalog.products.map((p) => [p.id, p]));

  const qtyByProduct = new Map<string, number>();
  input.lines.forEach((l) => qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + num(l.quantity)));
  const present = (id: string | null) => id !== null && (qtyByProduct.get(id) ?? 0) > 0;

  const add = (v: Omit<Violation, 'severity'> & { severity?: Violation['severity'] }) =>
    violations.push({ severity: 'error', ...v });

  // 1. Atributos e bundles, linha a linha.
  input.lines.forEach((line, i) => {
    const lineNumber = i + 1;
    const product = products.get(line.productId);
    if (!product) return;

    for (const attr of product.attributes ?? []) {
      const problem = validateAttribute(attr, line.attributes?.[attr.code]);
      if (problem) add({ ruleId: null, code: 'ATTRIBUTE_INVALID', lineNumber, productId: product.id, message: problem });
    }

    for (const c of product.bundle ?? []) {
      const have = qtyByProduct.get(c.componentProductId) ?? 0;
      const name = products.get(c.componentProductId)?.name ?? c.componentProductId;
      if (c.required && have <= 0) {
        add({ ruleId: null, code: 'BUNDLE_COMPONENT_MISSING', lineNumber, productId: product.id, targetProductId: c.componentProductId, message: `"${product.name}" exige o componente "${name}"` });
      } else if (have > 0 && c.minQuantity !== undefined && have < Number(c.minQuantity)) {
        add({ ruleId: null, code: 'BUNDLE_COMPONENT_QUANTITY', lineNumber, productId: product.id, targetProductId: c.componentProductId, message: `"${name}" requer pelo menos ${c.minQuantity} unidades em "${product.name}"` });
      } else if (have > 0 && c.maxQuantity !== undefined && have > Number(c.maxQuantity)) {
        add({ ruleId: null, code: 'BUNDLE_COMPONENT_QUANTITY', lineNumber, productId: product.id, targetProductId: c.componentProductId, message: `"${name}" admite no máximo ${c.maxQuantity} unidades em "${product.name}"` });
      }
    }
  });

  // 2. Regras CPQ, por prioridade (e id, para ordem determinística).
  const rules = catalog.rules
    .filter((r) => active(r, input.date))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  for (const rule of rules) {
    input.lines.forEach((line, i) => {
      if (line.productId !== rule.sourceProductId || num(line.quantity) <= 0) return;
      const lineNumber = i + 1;
      const source = products.get(rule.sourceProductId);
      const target = rule.targetProductId ? products.get(rule.targetProductId) : undefined;

      const ctx = {
        source: contextOf(line, source),
        target: { quantity: qtyByProduct.get(rule.targetProductId ?? '') ?? 0, sku: target?.sku },
        quote: { lineCount: input.lines.length, currency: input.currency, date: input.date },
        client: input.client,
      };
      if (!truthy(rule.condition, ctx)) return;

      const base = { ruleId: rule.id, lineNumber, productId: rule.sourceProductId, targetProductId: rule.targetProductId };
      const name = (p?: Product) => p?.name ?? '?';

      switch (rule.type) {
        case 'REQUIRES': {
          const min = Number(rule.params?.['targetMinQuantity'] ?? 0);
          const have = qtyByProduct.get(rule.targetProductId ?? '') ?? 0;
          if (!present(rule.targetProductId) || have < min) {
            add({ ...base, code: 'RULE_REQUIRES', message: rule.message ?? `"${name(source)}" requer "${name(target)}"` });
          }
          break;
        }
        case 'EXCLUDES':
          if (present(rule.targetProductId)) {
            add({ ...base, code: 'RULE_EXCLUDES', message: rule.message ?? `"${name(source)}" não é compatível com "${name(target)}"` });
          }
          break;
        case 'RECOMMENDS':
          if (!present(rule.targetProductId)) {
            add({ ...base, code: 'RULE_RECOMMENDS', severity: 'warning', message: rule.message ?? `Recomenda-se "${name(target)}" com "${name(source)}"` });
          }
          break;
        case 'CONSTRAINT': {
          const field = String(rule.params?.['field'] ?? 'quantity');
          const raw = field === 'quantity' ? num(line.quantity) : line.attributes?.[field.replace('attribute:', '')];
          const value = typeof raw === 'number' ? raw : Number(raw);
          const { min, max, step } = rule.params ?? {};
          const bad =
            (min !== undefined && value < Number(min)) ||
            (max !== undefined && value > Number(max)) ||
            (step !== undefined && !new D(value).mod(Number(step)).isZero());
          if (bad) add({ ...base, code: 'RULE_CONSTRAINT', message: rule.message ?? `Valor fora dos limites para "${field}"` });
          break;
        }
        case 'DEFAULT': {
          const attribute = String(rule.params?.['attribute'] ?? '');
          if (attribute && line.attributes?.[attribute] === undefined) {
            defaults.push({ lineNumber, attribute, value: rule.params?.['value'] as AttributeValue });
          }
          break;
        }
      }
    });
  }

  return { violations, defaults };
}

function contextOf(line: QuoteLineInput, product?: Product) {
  return {
    quantity: num(line.quantity),
    term: line.termMonths ?? null,
    discount: Number(line.discountPercent ?? 0),
    attr: line.attributes ?? {},
    sku: product?.sku,
    productId: line.productId,
  };
}
