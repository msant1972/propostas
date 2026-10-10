import { ConfigurationError } from '../errors.js';
import type { ISODate, PriceList } from '../types.js';

export interface PriceListContext {
  date: ISODate;
  currency: string;
  region: string | null;
  channel: string | null;
  clientTier: string | null;
}

const within = (l: PriceList, date: ISODate) => l.validFrom <= date && (l.validTo === null || l.validTo >= date);

/** Pontuação de especificidade, ou null se a lista não se aplica (campo preenchido que não coincide). */
function score(l: PriceList, ctx: PriceListContext): number | null {
  let s = 0;
  for (const [field, value] of [
    [l.region, ctx.region],
    [l.channel, ctx.channel],
    [l.clientTier, ctx.clientTier],
  ] as const) {
    if (field === null) continue;
    if (field !== value) return null;
    s += 1;
  }
  return s;
}

/**
 * Escolhe a lista aplicável: moeda e vigência exatas; vence a de maior especificidade
 * (região, canal, tier), depois a de `validFrom` mais recente. Empate residual é erro de configuração.
 */
export function selectPriceList(lists: PriceList[], ctx: PriceListContext): PriceList {
  const candidates = lists
    .filter((l) => l.currency === ctx.currency && within(l, ctx.date))
    .map((l) => ({ l, s: score(l, ctx) }))
    .filter((c): c is { l: PriceList; s: number } => c.s !== null);

  if (candidates.length === 0) {
    throw new ConfigurationError('NO_PRICE_LIST', `Sem lista de preços em ${ctx.currency} vigente em ${ctx.date}`);
  }
  candidates.sort((a, b) => b.s - a.s || (a.l.validFrom < b.l.validFrom ? 1 : a.l.validFrom > b.l.validFrom ? -1 : 0));
  const [best, second] = candidates;
  if (second && second.s === best!.s && second.l.validFrom === best!.l.validFrom) {
    throw new ConfigurationError('AMBIGUOUS_PRICE_LIST', `Listas "${best!.l.name}" e "${second.l.name}" empatam em especificidade`);
  }
  return best!.l;
}

/** Validação ao gravar listas: mesma moeda e mesmos critérios com períodos sobrepostos não são permitidos. */
export function findPriceListOverlaps(lists: PriceList[]): Array<[PriceList, PriceList]> {
  const out: Array<[PriceList, PriceList]> = [];
  for (let i = 0; i < lists.length; i++) {
    for (let j = i + 1; j < lists.length; j++) {
      const a = lists[i]!;
      const b = lists[j]!;
      const sameKey =
        a.currency === b.currency && a.region === b.region && a.channel === b.channel && a.clientTier === b.clientTier;
      const overlap = a.validFrom <= (b.validTo ?? '9999-12-31') && b.validFrom <= (a.validTo ?? '9999-12-31');
      if (sameKey && overlap) out.push([a, b]);
    }
  }
  return out;
}
