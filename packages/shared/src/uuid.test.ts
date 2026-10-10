import { describe, expect, it } from 'vitest';
import { uuidFromBytes, uuidToBytes, uuidv7 } from './uuid.js';

describe('uuidv7', () => {
  it('tem versão 7 e variante RFC', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('ordena por tempo', () => {
    const ids = [1_000, 2_000, 3_000].map((t) => uuidv7(t));
    expect([...ids].sort()).toEqual(ids);
  });

  it('codifica o timestamp nos primeiros 48 bits', () => {
    const t = 1_791_600_000_123;
    const hex = uuidv7(t).replace(/-/g, '').slice(0, 12);
    expect(parseInt(hex, 16)).toBe(t);
  });

  it('converte de e para bytes sem perdas', () => {
    const id = uuidv7();
    expect(uuidFromBytes(uuidToBytes(id))).toBe(id);
  });

  it('rejeita UUID inválido', () => {
    expect(() => uuidToBytes('abc')).toThrow();
  });
});
