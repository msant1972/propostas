import { Decimal } from 'decimal.js';

// Isolado do Decimal global para não depender da configuração de outros pacotes.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type D = InstanceType<typeof D>;
export type DValue = Decimal.Value;

/** Arredondamento monetário: 2 casas, *half-up*. */
export const round2 = (x: DValue): D => new D(x).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const round4 = (x: DValue): D => new D(x).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);

/** Montantes e taxas circulam como texto decimal (sem erros de vírgula flutuante, estáveis em JSON e hash). */
export const money = (x: DValue): string => round2(x).toFixed(2);
export const price4 = (x: DValue): string => round4(x).toFixed(4);
