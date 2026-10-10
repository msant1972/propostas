import { ConfigurationError } from '../errors.js';
import type { ClientContext, ISODate, TaxCategory, TaxRate, TaxRegime } from '../types.js';

export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/**
 * Regime de IVA (determinado no servidor e repetido no browser só para pré-visualização):
 *  - mesmo país da entidade emitente: a categoria fiscal do produto decide (padrão, reduzida, isenta);
 *  - empresa de outro Estado-Membro com VAT válido: autoliquidação, 0 %;
 *  - cliente fora da UE: fora do âmbito, 0 %;
 *  - consumidor final ou VAT inválido noutro Estado-Membro: aplica-se a taxa do país do emitente.
 */
export function determineRegime(issuerCountry: string, client: ClientContext, category: TaxCategory): TaxRegime {
  if (category === 'OUTSIDE_SCOPE') return 'OUTSIDE_SCOPE';
  if (client.countryCode === issuerCountry) return category;
  if (!EU_COUNTRIES.has(client.countryCode)) return 'OUTSIDE_SCOPE';
  if (client.isBusiness && client.vatValid) return 'REVERSE_CHARGE';
  return category;
}

export interface AppliedTax {
  regime: TaxRegime;
  ratePercent: string;
}

export function applicableTax(
  rates: TaxRate[],
  issuerCountry: string,
  client: ClientContext,
  category: TaxCategory,
  date: ISODate,
): AppliedTax {
  const regime = determineRegime(issuerCountry, client, category);
  if (regime === 'REVERSE_CHARGE' || regime === 'OUTSIDE_SCOPE') return { regime, ratePercent: '0.00' };

  const rate = rates.find(
    (r) =>
      r.countryCode === issuerCountry &&
      r.regime === regime &&
      r.taxCategory === category &&
      r.validFrom <= date &&
      (r.validTo === null || r.validTo >= date),
  );
  if (!rate) {
    throw new ConfigurationError('NO_TAX_RATE', `Sem taxa de IVA para ${issuerCountry}/${category}/${regime} em ${date}`);
  }
  return { regime, ratePercent: rate.ratePercent };
}
