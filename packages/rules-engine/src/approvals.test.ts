import { describe, expect, it } from 'vitest';
import { approvalVars, evaluatePolicies, validatePolicy, type ApprovalPolicy } from './approvals.js';
import { calculateQuote } from './pricing/calculate.js';
import { baseCatalog, quote } from './fixtures.js';

const policy = (over: Partial<ApprovalPolicy> & { id: string }): ApprovalPolicy => ({
  name: over.id, scope: 'COMMERCIAL', condition: null, mode: 'SEQUENTIAL', priority: 100, isActive: true,
  validFrom: '2026-01-01', validTo: null, levels: [{ level: 1, role: 'Gestor_Comercial', slaHours: 24 }], ...over,
});

const vars = (over: Partial<ReturnType<typeof approvalVars>> = {}) => ({
  max_line_discount_percent: 0, global_discount_percent: 0, margin_percent: 40, grand_total: 1000, tcv: 1000, has_modified_legal_section: false, ...over,
});

const OR = { or: [{ '>': [{ var: 'max_line_discount_percent' }, 15] }, { '<': [{ var: 'margin_percent' }, 25] }, { '>': [{ var: 'grand_total' }, 100000] }] };

describe('evaluatePolicies', () => {
  const p = policy({ id: 'comercial', condition: OR });
  it('dispara por desconto, margem ou valor', () => {
    expect(evaluatePolicies([p], vars({ max_line_discount_percent: 16 }), '2026-10-11')).toHaveLength(1);
    expect(evaluatePolicies([p], vars({ margin_percent: 24.9 }), '2026-10-11')).toHaveLength(1);
    expect(evaluatePolicies([p], vars({ grand_total: 100001 }), '2026-10-11')).toHaveLength(1);
  });
  it('não dispara dentro dos limites', () => {
    expect(evaluatePolicies([p], vars({ max_line_discount_percent: 15, margin_percent: 25, grand_total: 100000 }), '2026-10-11')).toEqual([]);
  });
  it('ignora políticas inativas ou fora de vigência', () => {
    expect(evaluatePolicies([{ ...p, isActive: false }], vars({ grand_total: 999999 }), '2026-10-11')).toEqual([]);
    expect(evaluatePolicies([{ ...p, validTo: '2026-06-30' }], vars({ grand_total: 999999 }), '2026-10-11')).toEqual([]);
  });
  it('por âmbito aplica-se só a de menor prioridade; âmbitos diferentes somam-se', () => {
    const strict = policy({ id: 'a', priority: 10, condition: null });
    const loose = policy({ id: 'b', priority: 50, condition: null });
    const legal = policy({ id: 'j', scope: 'LEGAL', condition: { '==': [{ var: 'has_modified_legal_section' }, true] }, levels: [{ level: 1, role: 'Juridico', slaHours: 48 }] });
    expect(evaluatePolicies([loose, strict], vars(), '2026-10-11').map((x) => x.id)).toEqual(['a']);
    expect(evaluatePolicies([strict, legal], vars({ has_modified_legal_section: true }), '2026-10-11').map((x) => x.id).sort()).toEqual(['a', 'j']);
  });
});

describe('approvalVars', () => {
  it('extrai desconto máximo, margem e totais de uma cotação calculada', () => {
    const input = quote({ globalDiscountPercent: '5', lines: [{ productId: 'IMP', quantity: '10', discountPercent: '20' }, { productId: 'PEN', quantity: '1' }] });
    const r = calculateQuote(input, baseCatalog());
    const v = approvalVars(input, r, true);
    expect(v).toMatchObject({ max_line_discount_percent: 20, global_discount_percent: 5, has_modified_legal_section: true });
    expect(v.grand_total).toBe(Number(r.totals.grandTotal));
    expect(v.margin_percent).toBeLessThan(100);
  });
});

describe('validatePolicy', () => {
  it('aceita políticas bem formadas', () => {
    expect(validatePolicy({ condition: OR, mode: 'SEQUENTIAL', levels: [{ level: 1, role: 'A', slaHours: 1 }, { level: 2, role: 'B', slaHours: 2 }] })).toBeNull();
  });
  it('recusa níveis em falta, saltos, SLA inválido e condições inválidas', () => {
    expect(validatePolicy({ condition: null, mode: 'SEQUENTIAL', levels: [] })).toMatch(/pelo menos um/);
    expect(validatePolicy({ condition: null, mode: 'SEQUENTIAL', levels: [{ level: 2, role: 'A', slaHours: 1 }] })).toMatch(/saltos/);
    expect(validatePolicy({ condition: null, mode: 'SEQUENTIAL', levels: [{ level: 1, role: 'A', slaHours: 0 }] })).toMatch(/SLA/);
    expect(validatePolicy({ condition: { inventado: [1] }, mode: 'SEQUENTIAL', levels: [{ level: 1, role: 'A', slaHours: 1 }] })).toMatch(/inválida/);
  });
});
