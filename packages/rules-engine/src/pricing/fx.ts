import { Decimal } from 'decimal.js';
import { ConfigurationError } from '../errors.js';
import type { FxRate, ISODate } from '../types.js';

/** Taxa `from → to` mais recente com data ≤ `date`; tenta a inversa se a direta não existir. */
export function fxRate(rates: FxRate[], from: string, to: string, date: ISODate): string {
  if (from === to) return '1';
  const pick = (base: string, quote: string) =>
    rates
      .filter((r) => r.baseCurrency === base && r.quoteCurrency === quote && r.rateDate <= date)
      .sort((a, b) => (a.rateDate < b.rateDate ? 1 : -1))[0];

  const direct = pick(from, to);
  if (direct) return direct.rate;
  const inverse = pick(to, from);
  if (inverse) return new Decimal(1).div(inverse.rate).toDecimalPlaces(8, Decimal.ROUND_HALF_UP).toString();
  throw new ConfigurationError('MISSING_FX', `Sem taxa de câmbio ${from}→${to} até ${date}`);
}
