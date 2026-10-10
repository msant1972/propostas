import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../errors.js';
import type { PriceList } from '../types.js';
import { findPriceListOverlaps, selectPriceList } from './price-list.js';

const list = (over: Partial<PriceList> & { id: string }): PriceList => ({
  name: over.id, currency: 'EUR', region: null, channel: null, clientTier: null,
  validFrom: '2026-01-01', validTo: null, items: [], ...over,
});
const ctx = { date: '2026-10-10', currency: 'EUR', region: 'PT', channel: 'direct', clientTier: 'gold' };

describe('selectPriceList', () => {
  it('vence a lista mais específica', () => {
    const l = selectPriceList([list({ id: 'geral' }), list({ id: 'pt', region: 'PT' }), list({ id: 'pt-gold', region: 'PT', clientTier: 'gold' })], ctx);
    expect(l.id).toBe('pt-gold');
  });

  it('exclui listas cujo critério não coincide', () => {
    expect(selectPriceList([list({ id: 'es', region: 'ES' }), list({ id: 'geral' })], ctx).id).toBe('geral');
  });

  it('respeita moeda e vigência', () => {
    const lists = [list({ id: 'usd', currency: 'USD' }), list({ id: 'velha', validTo: '2026-06-30' }), list({ id: 'nova', validFrom: '2026-07-01' })];
    expect(selectPriceList(lists, ctx).id).toBe('nova');
  });

  it('em igualdade de especificidade, vence a de início mais recente', () => {
    expect(selectPriceList([list({ id: 'a', validFrom: '2026-01-01' }), list({ id: 'b', validFrom: '2026-05-01' })], ctx).id).toBe('b');
  });

  it('empate total é erro de configuração', () => {
    const e = (() => { try { selectPriceList([list({ id: 'a' }), list({ id: 'b' })], ctx); } catch (x) { return x; } })();
    expect(e).toBeInstanceOf(ConfigurationError);
    expect((e as ConfigurationError).code).toBe('AMBIGUOUS_PRICE_LIST');
  });

  it('sem lista aplicável é erro de configuração', () => {
    expect(() => selectPriceList([list({ id: 'usd', currency: 'USD' })], ctx)).toThrow(/Sem lista/);
  });
});

describe('findPriceListOverlaps', () => {
  it('deteta períodos sobrepostos com os mesmos critérios', () => {
    const a = list({ id: 'a', validTo: '2026-12-31' });
    const b = list({ id: 'b', validFrom: '2026-12-01' });
    expect(findPriceListOverlaps([a, b])).toHaveLength(1);
  });

  it('aceita períodos consecutivos e critérios diferentes', () => {
    const a = list({ id: 'a', validTo: '2026-06-30' });
    const b = list({ id: 'b', validFrom: '2026-07-01' });
    const c = list({ id: 'c', region: 'PT' });
    expect(findPriceListOverlaps([a, b, c])).toHaveLength(0);
  });
});
