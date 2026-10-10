import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  calculateQuote, ConfigurationError, type AttributeValue, type Catalog, type ProductAttribute, type QuoteInput, type QuoteResult,
} from '@cpq/rules-engine';
import { Button, Input, Select } from './ui';

export interface EditorLine {
  productId: string;
  quantity: string;
  termMonths: string;
  discountPercent: string;
  attributes: Record<string, AttributeValue>;
}

export interface EditorState {
  lines: EditorLine[];
  globalDiscountPercent: string;
}

interface Props {
  catalog: Catalog;
  currency: string;
  client: { countryCode: string; tier: string | null; vatNumber: string | null; vatValid: boolean };
  issuerCountry: string;
  state: EditorState;
  onChange: (s: EditorState) => void;
  readOnly: boolean;
  showMargin: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export function toInput(p: Pick<Props, 'currency' | 'client' | 'issuerCountry'>, s: EditorState): QuoteInput {
  return {
    date: today(),
    currency: p.currency,
    channel: null,
    issuerCountry: p.issuerCountry,
    client: { countryCode: p.client.countryCode, tier: p.client.tier, region: null, isBusiness: !!p.client.vatNumber, vatValid: p.client.vatValid },
    globalDiscountPercent: s.globalDiscountPercent || '0',
    lines: s.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity || '0',
      termMonths: l.termMonths ? Number(l.termMonths) : undefined,
      discountPercent: l.discountPercent || '0',
      attributes: l.attributes,
    })),
  };
}

/** Avalia localmente com o mesmo motor do servidor (resposta imediata); o servidor revalida sempre ao gravar. */
export function evaluate(p: Pick<Props, 'currency' | 'client' | 'issuerCountry' | 'catalog'>, s: EditorState): { result?: QuoteResult; problem?: string } {
  try {
    return { result: calculateQuote(toInput(p, s), p.catalog) };
  } catch (e) {
    if (e instanceof ConfigurationError) return { problem: e.message };
    throw e;
  }
}

function AttributeInput({ attr, value, onChange, disabled }: { attr: ProductAttribute; value: AttributeValue | undefined; onChange: (v: AttributeValue | undefined) => void; disabled: boolean }) {
  const id = `attr-${attr.code}`;
  if (attr.type === 'BOOLEAN') {
    return <input id={id} aria-label={attr.code} type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (attr.type === 'LIST') {
    return (
      <Select id={id} aria-label={attr.code} disabled={disabled} value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="" />
        {attr.allowedValues?.map((v) => <option key={v}>{v}</option>)}
      </Select>
    );
  }
  return (
    <Input id={id} aria-label={attr.code} type="number" disabled={disabled} value={value === undefined ? '' : String(value)}
      step={attr.step ?? (attr.type === 'INTEGER' ? 1 : 'any')} min={attr.min} max={attr.max}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  );
}

export function QuoteEditor({ catalog, currency, client, issuerCountry, state, onChange, readOnly, showMargin }: Props) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState('');
  const products = useMemo(() => new Map(catalog.products.map((p) => [p.id, p])), [catalog]);
  const { result, problem } = useMemo(() => evaluate({ catalog, currency, client, issuerCountry }, state), [catalog, currency, client, issuerCountry, state]);

  const setLine = (i: number, patch: Partial<EditorLine>) =>
    onChange({ ...state, lines: state.lines.map((l, n) => (n === i ? { ...l, ...patch } : l)) });

  function addLine() {
    const p = products.get(adding);
    if (!p) return;
    onChange({
      ...state,
      lines: [...state.lines, { productId: p.id, quantity: '1', termMonths: p.billingModel === 'RECURRING' ? '12' : '', discountPercent: '0', attributes: {} }],
    });
    setAdding('');
  }

  const money = (v: string) => `${v} ${currency}`;

  return (
    <div className="space-y-4">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="py-2">{t('quote.product')}</th><th>{t('quote.quantity')}</th><th>{t('quote.term')}</th><th>{t('quote.discount')}</th>
            <th className="text-right">{t('quote.unitPrice')}</th><th className="text-right">{t('quote.lineTotal')}</th><th />
          </tr>
        </thead>
        <tbody>
          {state.lines.map((l, i) => {
            const p = products.get(l.productId);
            const r = result?.lines.find((x) => x.lineNumber === i + 1);
            const lineIssues = result?.violations.filter((v) => v.lineNumber === i + 1) ?? [];
            return (
              <>
                <tr key={`l${i}`} className="border-b border-[var(--border)] align-top">
                  <td className="py-2">{p?.name ?? l.productId}</td>
                  <td><Input aria-label={`${t('quote.quantity')} ${i + 1}`} className="w-24" disabled={readOnly} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                  <td>{p?.billingModel === 'RECURRING' ? <Input aria-label={`${t('quote.term')} ${i + 1}`} className="w-20" disabled={readOnly} value={l.termMonths} onChange={(e) => setLine(i, { termMonths: e.target.value })} /> : '—'}</td>
                  <td><Input aria-label={`${t('quote.discount')} ${i + 1}`} className="w-20" disabled={readOnly} value={l.discountPercent} onChange={(e) => setLine(i, { discountPercent: e.target.value })} /></td>
                  <td className="text-right">{r ? r.netUnitPrice : '—'}</td>
                  <td className="text-right">{r ? r.lineTotal : '—'}</td>
                  <td className="text-right">{!readOnly && <Button variant="ghost" onClick={() => onChange({ ...state, lines: state.lines.filter((_, n) => n !== i) })}>{t('quote.remove')}</Button>}</td>
                </tr>
                {(p?.attributes?.length ?? 0) > 0 && (
                  <tr key={`a${i}`} className="border-b border-[var(--border)]">
                    <td colSpan={7} className="pb-2">
                      <div className="flex flex-wrap items-center gap-4 text-xs">
                        <span className="opacity-70">{t('quote.attributes')}:</span>
                        {p!.attributes!.map((a) => (
                          <label key={a.code} className="flex items-center gap-2">{a.code}
                            <AttributeInput attr={a} disabled={readOnly} value={l.attributes[a.code]}
                              onChange={(v) => { const next = { ...l.attributes }; if (v === undefined) delete next[a.code]; else next[a.code] = v; setLine(i, { attributes: next }); }} />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                {lineIssues.length > 0 && (
                  <tr key={`v${i}`}><td colSpan={7} className="pb-2 text-xs">{lineIssues.map((v, n) => <div key={n} role={v.severity === 'error' ? 'alert' : undefined} className={v.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>{v.message}</div>)}</td></tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>

      {!readOnly && (
        <div className="flex max-w-xl items-center gap-2">
          <Select aria-label={t('quote.product')} value={adding} onChange={(e) => setAdding(e.target.value)}>
            <option value="">{t('quote.product')}</option>
            {catalog.products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
          </Select>
          <Button variant="outline" onClick={addLine} disabled={!adding}>{t('quote.addLine')}</Button>
        </div>
      )}

      <div className="flex items-center gap-3 text-sm">
        <label htmlFor="gd">{t('quote.globalDiscount')}</label>
        <Input id="gd" className="w-24" disabled={readOnly} value={state.globalDiscountPercent} onChange={(e) => onChange({ ...state, globalDiscountPercent: e.target.value })} />
      </div>

      {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
      {result && state.lines.length === 0 && <p className="text-sm opacity-70">{t('quote.noLines')}</p>}

      {result && result.violations.some((v) => v.lineNumber === null) && (
        <div className="text-sm">{result.violations.filter((v) => v.lineNumber === null).map((v, n) => <div key={n} role="alert" className="text-red-600">{v.message}</div>)}</div>
      )}

      {result && state.lines.length > 0 && (
        <dl className="grid max-w-md grid-cols-[1fr_auto] gap-y-1 text-sm" data-testid="totals">
          <dt>{t('quote.subtotal')}</dt><dd className="text-right">{money(result.totals.subtotal)}</dd>
          <dt>{t('quote.discountTotal')}</dt><dd className="text-right">−{money(result.totals.discountAmount)}</dd>
          <dt>{t('quote.totalTax')}</dt><dd className="text-right">{money(result.totals.totalTax)}</dd>
          <dt className="font-semibold">{t('quote.grandTotal')}</dt><dd className="text-right font-semibold">{money(result.totals.grandTotal)}</dd>
          <dt>{t('quote.mrr')}</dt><dd className="text-right">{money(result.totals.mrr)}</dd>
          <dt>{t('quote.tcv')}</dt><dd className="text-right">{money(result.totals.tcv)}</dd>
          {showMargin && result.totals.marginPercent !== null && (<><dt>{t('quote.margin')}</dt><dd className="text-right">{result.totals.marginPercent} %</dd></>)}
        </dl>
      )}
    </div>
  );
}
