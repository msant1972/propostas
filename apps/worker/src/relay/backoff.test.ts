import { describe, expect, it } from 'vitest';
import { backoffMs } from './backoff.js';

describe('backoffMs', () => {
  it('cresce exponencialmente com jitter dentro de [exp/2, exp]', () => {
    expect(backoffMs(1, () => 0)).toBe(2_500);
    expect(backoffMs(1, () => 0.999999)).toBeLessThanOrEqual(5_000);
    expect(backoffMs(3, () => 0)).toBe(10_000);
  });

  it('respeita o teto de 15 minutos', () => {
    expect(backoffMs(30, () => 0.999999)).toBeLessThanOrEqual(900_000);
  });
});
