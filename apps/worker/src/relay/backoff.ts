/** Atraso exponencial com *jitter* completo: base 2^tentativa × 5 s, no máximo 15 min. */
export function backoffMs(attempts: number, rng: () => number = Math.random): number {
  const cap = 15 * 60_000;
  const exp = Math.min(cap, 5_000 * 2 ** Math.max(0, attempts - 1));
  return Math.floor(exp / 2 + rng() * (exp / 2));
}
