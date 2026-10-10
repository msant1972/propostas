import { describe, expect, it } from 'vitest';
import { defineAbilityFor } from '../authz/ability.js';
import { maskCost } from './mask-cost.js';

const sample = { totals: { marginPercent: '35.02', grandTotal: '10.00' }, lines: [{ marginPercent: '10.00', lineTotal: '5.00' }] };
const actor = (roles: Parameters<typeof defineAbilityFor>[0]['roles']) => defineAbilityFor({ userId: 'u', teamId: 't', region: null, roles });

describe('maskCost', () => {
  it('esconde margens ao comercial', () => {
    const r = maskCost(sample, actor(['Comercial']));
    expect(r.totals).toEqual({ marginPercent: null, grandTotal: '10.00' });
    expect(r.lines[0]).toEqual({ marginPercent: null, lineTotal: '5.00' });
  });
  it('mantém margens ao gestor', () => {
    expect(maskCost(sample, actor(['Gestor_Comercial']))).toEqual(sample);
  });
});
