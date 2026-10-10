import { describe, expect, it } from 'vitest';
import { baseCatalog, product, quote, rule } from '../fixtures.js';
import type { Catalog } from '../types.js';
import { evaluateRules } from './evaluate.js';

const withRules = (rules: Catalog['rules']): Catalog => ({ ...baseCatalog(), rules });
const codes = (r: ReturnType<typeof evaluateRules>) => r.violations.map((v) => v.code);

describe('regras CPQ', () => {
  const premium = rule({
    id: 'r1', sourceProductId: 'LIC', targetProductId: 'PRM', type: 'REQUIRES',
    condition: { '>': [{ var: 'source.quantity' }, 50] },
    message: 'Mais de 50 licenças exige Suporte Premium',
  });

  it('REQUIRES com condição: só dispara acima de 50 licenças', () => {
    const cat = withRules([premium]);
    expect(codes(evaluateRules(quote({ lines: [{ productId: 'LIC', quantity: '50', termMonths: 12 }] }), cat))).toEqual([]);
    const r = evaluateRules(quote({ lines: [{ productId: 'LIC', quantity: '51', termMonths: 12 }] }), cat);
    expect(r.violations).toMatchObject([{ code: 'RULE_REQUIRES', severity: 'error', lineNumber: 1, message: 'Mais de 50 licenças exige Suporte Premium' }]);
  });

  it('REQUIRES fica satisfeita quando o alvo está na cotação', () => {
    const q = quote({ lines: [{ productId: 'LIC', quantity: '60', termMonths: 12 }, { productId: 'PRM', quantity: '1', termMonths: 12 }] });
    expect(codes(evaluateRules(q, withRules([premium])))).toEqual([]);
  });

  it('EXCLUDES e RECOMMENDS', () => {
    const cat = withRules([
      rule({ id: 'x', sourceProductId: 'LIC', targetProductId: 'IMP', type: 'EXCLUDES' }),
      rule({ id: 'rec', sourceProductId: 'LIC', targetProductId: 'SUP', type: 'RECOMMENDS' }),
    ]);
    const r = evaluateRules(quote({ lines: [{ productId: 'LIC', quantity: '1', termMonths: 12 }, { productId: 'IMP', quantity: '1' }] }), cat);
    // ordem: prioridade e depois id ('rec' < 'x')
    expect(r.violations.map((v) => [v.code, v.severity])).toEqual([['RULE_RECOMMENDS', 'warning'], ['RULE_EXCLUDES', 'error']]);
  });

  it('CONSTRAINT limita a quantidade', () => {
    const cat = withRules([rule({ id: 'c', sourceProductId: 'LIC', type: 'CONSTRAINT', params: { field: 'quantity', min: 5, max: 100, step: 5 } })]);
    const run = (qty: string) => codes(evaluateRules(quote({ lines: [{ productId: 'LIC', quantity: qty, termMonths: 12 }] }), cat));
    expect(run('10')).toEqual([]);
    expect(run('3')).toEqual(['RULE_CONSTRAINT']);
    expect(run('101')).toEqual(['RULE_CONSTRAINT']);
    expect(run('7')).toEqual(['RULE_CONSTRAINT']);
  });

  it('DEFAULT sugere valor para atributo em falta', () => {
    const cat = withRules([rule({ id: 'd', sourceProductId: 'LIC', type: 'DEFAULT', params: { attribute: 'regiao', value: 'PT' } })]);
    expect(evaluateRules(quote({ lines: [{ productId: 'LIC', quantity: '1', termMonths: 12 }] }), cat).defaults).toEqual([{ lineNumber: 1, attribute: 'regiao', value: 'PT' }]);
    expect(evaluateRules(quote({ lines: [{ productId: 'LIC', quantity: '1', termMonths: 12, attributes: { regiao: 'ES' } }] }), cat).defaults).toEqual([]);
  });

  it('ignora regras inativas ou fora de vigência', () => {
    const q = quote({ lines: [{ productId: 'LIC', quantity: '1', termMonths: 12 }] });
    const base = { id: 'e', sourceProductId: 'LIC', targetProductId: 'SUP', type: 'REQUIRES' as const };
    expect(codes(evaluateRules(q, withRules([rule({ ...base, isActive: false })])))).toEqual([]);
    expect(codes(evaluateRules(q, withRules([rule({ ...base, validTo: '2026-06-30' })])))).toEqual([]);
    expect(codes(evaluateRules(q, withRules([rule({ ...base, validFrom: '2027-01-01' })])))).toEqual([]);
    expect(codes(evaluateRules(q, withRules([rule(base)])))).toEqual(['RULE_REQUIRES']);
  });

  it('a condição pode usar o cliente e atributos', () => {
    const cat = withRules([rule({ id: 'k', sourceProductId: 'LIC', targetProductId: 'SUP', type: 'REQUIRES', condition: { and: [{ '==': [{ var: 'client.tier' }, 'gold'] }, { '>=': [{ var: 'source.attr.sites' }, 2] }] } })]);
    const q = (tier: string | null) => quote({ client: { countryCode: 'PT', tier, region: null, isBusiness: true, vatValid: true }, lines: [{ productId: 'LIC', quantity: '1', termMonths: 12, attributes: { sites: 3 } }] });
    expect(codes(evaluateRules(q('gold'), cat))).toEqual(['RULE_REQUIRES']);
    expect(codes(evaluateRules(q('silver'), cat))).toEqual([]);
  });
});

describe('atributos e bundles', () => {
  it('valida tipo, limites, passo e obrigatoriedade', () => {
    const cat = baseCatalog();
    cat.products.push(product({ id: 'CFG', sku: 'CFG', attributes: [
      { code: 'sites', type: 'INTEGER', min: 1, max: 10, step: 1, required: true },
      { code: 'nivel', type: 'LIST', allowedValues: ['A', 'B'] },
      { code: 'cloud', type: 'BOOLEAN' },
      { code: 'gb', type: 'DECIMAL', min: 0, step: 0.5 },
    ] }));
    const run = (attributes: Record<string, string | number | boolean>) =>
      evaluateRules(quote({ lines: [{ productId: 'CFG', quantity: '1', attributes }] }), cat).violations.map((v) => v.message);
    expect(run({ sites: 3, nivel: 'A', cloud: true, gb: 1.5 })).toEqual([]);
    expect(run({})).toHaveLength(1); // sites obrigatório
    expect(run({ sites: 11 })).toHaveLength(1);
    expect(run({ sites: 2.5 })).toHaveLength(1);
    expect(run({ sites: 2, nivel: 'C' })).toHaveLength(1);
    expect(run({ sites: 2, cloud: 'sim' as never })).toHaveLength(1);
    expect(run({ sites: 2, gb: 1.2 })).toHaveLength(1);
  });

  it('bundle exige componentes obrigatórios e respeita limites', () => {
    const cat = baseCatalog();
    cat.products.push(product({ id: 'PKG', sku: 'PKG', bundle: [
      { componentProductId: 'SUP', required: true, defaultQuantity: '1', minQuantity: '1', maxQuantity: '3' },
      { componentProductId: 'IMP', required: false, defaultQuantity: '10' },
    ] }));
    const run = (extra: Array<{ productId: string; quantity: string }>) =>
      evaluateRules(quote({ lines: [{ productId: 'PKG', quantity: '1' }, ...extra] }), cat).violations.map((v) => v.code);
    expect(run([])).toEqual(['BUNDLE_COMPONENT_MISSING']);
    expect(run([{ productId: 'SUP', quantity: '2' }])).toEqual([]);
    expect(run([{ productId: 'SUP', quantity: '4' }])).toEqual(['BUNDLE_COMPONENT_QUANTITY']);
  });
});
