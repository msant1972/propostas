import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { components } from '@cpq/api-client';
import type { Catalog } from '@cpq/rules-engine';
import { useAuth } from '../auth/store';
import { evaluate, QuoteEditor, type EditorState } from '../components/QuoteEditor';
import { DocumentPanel } from '../components/DocumentPanel';
import { Timeline } from '../components/Timeline';
import { WorkflowBar } from '../components/WorkflowBar';
import { Button } from '../components/ui';
import { ApiError, apiGet, apiPost, apiPut } from '../lib/api';

type Proposal = components['schemas']['ProposalDto'];
type Client = components['schemas']['ClientDto'];
type Quote = components['schemas']['QuoteVersionDto'];
type Summary = components['schemas']['QuoteVersionSummaryDto'];
type Verify = components['schemas']['VerifyQuoteDto'];

const ISSUER_COUNTRY = 'PT';

function fromQuote(q: Quote): EditorState {
  return {
    globalDiscountPercent: q.globalDiscountPercent,
    lines: q.lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity.replace(/\.?0+$/, '') || '0',
      termMonths: l.termMonths ? String(l.termMonths) : '',
      discountPercent: l.discountPercent,
      attributes: (l.attributes ?? {}) as Record<string, string | number | boolean>,
    })),
  };
}

export function ProposalPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const roles = useAuth((s) => s.session?.roles ?? []);
  const canSeeMargin = roles.some((r) => ['Gestor_Comercial', 'Aprovador_Financeiro', 'Administrador'].includes(r));

  const proposal = useQuery({ queryKey: ['proposal', id], queryFn: () => apiGet<Proposal>(`/proposals/${id}`) });
  const client = useQuery({ queryKey: ['client', proposal.data?.clientId], queryFn: () => apiGet<Client>(`/clients/${proposal.data!.clientId}`), enabled: !!proposal.data });
  const catalog = useQuery({ queryKey: ['engine-catalog'], queryFn: () => apiGet<Catalog>('/cpq/catalog'), staleTime: 60_000 });
  const quote = useQuery({ queryKey: ['quote', id], queryFn: () => apiGet<Quote>(`/proposals/${id}/quotes/current`) });
  const versions = useQuery({ queryKey: ['versions', id], queryFn: () => apiGet<Summary[]>(`/proposals/${id}/quotes`) });

  const [state, setState] = useState<EditorState>({ lines: [], globalDiscountPercent: '0' });
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [verify, setVerify] = useState<Verify | null>(null);
  const [tab, setTab] = useState<'quote' | 'document' | 'history'>('quote');

  useEffect(() => {
    if (quote.data) setState(fromQuote(quote.data));
  }, [quote.data]);

  const readOnly = quote.data?.status !== 'DRAFT';

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['quote', id] });
    void qc.invalidateQueries({ queryKey: ['versions', id] });
  };

  const body = useMemo(() => ({
    globalDiscountPercent: state.globalDiscountPercent || '0',
    lines: state.lines.map((l) => ({
      productId: l.productId, quantity: l.quantity, termMonths: l.termMonths ? Number(l.termMonths) : undefined,
      discountPercent: l.discountPercent || '0', attributes: l.attributes,
    })),
  }), [state]);

  function onError(e: unknown) {
    setMessage(null);
    const problem = e instanceof ApiError ? (e.body as { errors?: unknown; violations?: { message: string }[] } | undefined) : undefined;
    setErrors(problem?.violations?.map((v) => v.message) ?? [e instanceof Error ? e.message : t('common.error')]);
  }

  const save = useMutation({
    mutationFn: () => apiPut<Quote>(`/proposals/${id}/quotes/${quote.data!.id}`, body),
    onSuccess: () => { setErrors([]); setMessage(t('quote.savedOk')); refresh(); },
    onError,
  });
  const lock = useMutation({
    mutationFn: async () => { await apiPut(`/proposals/${id}/quotes/${quote.data!.id}`, body); return apiPost<Quote>(`/proposals/${id}/quotes/${quote.data!.id}/lock`); },
    onSuccess: () => { setErrors([]); setMessage(t('quote.lockedOk')); refresh(); },
    onError,
  });
  const newVersion = useMutation({
    mutationFn: () => apiPost<Quote>(`/proposals/${id}/quotes/new-version`),
    onSuccess: () => { setErrors([]); setMessage(null); setVerify(null); refresh(); },
    onError,
  });
  const check = useMutation({
    mutationFn: () => apiGet<Verify>(`/proposals/${id}/quotes/${quote.data!.id}/verify`),
    onSuccess: setVerify,
    onError,
  });

  if (proposal.isPending || quote.isPending) return <p>{t('common.loading')}</p>;
  if (proposal.isError || quote.isError) return <p role="alert">{t('common.error')}</p>;

  const p = proposal.data;
  const q = quote.data;
  const localInvalid = catalog.data && client.data ? !(evaluate({ catalog: catalog.data, currency: q.currency, client: client.data, issuerCountry: ISSUER_COUNTRY }, state).result?.valid ?? false) : true;

  return (
    <section className="space-y-6">
      <Link to="/propostas" className="text-sm underline">{t('common.back')}</Link>
      <div>
        <h1 className="text-2xl font-semibold">{p.title}</h1>
        <p className="text-sm opacity-70">{p.code} · {client.data?.name} · {t(`status.${p.status}`)}</p>
      </div>

      <div role="tablist" className="flex gap-1 border-b border-[var(--border)]">
        {(['quote', 'document', 'history'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm ${tab === k ? 'border-b-2 border-[var(--primary)] font-semibold' : 'opacity-70'}`}>
            {t(k === 'quote' ? 'doc.tabQuote' : k === 'document' ? 'doc.tabDocument' : 'wf.tabHistory')}
          </button>
        ))}
      </div>

      <WorkflowBar proposalId={id} onChanged={refresh} />
      {p.status === 'DRAFT' && p.statusReason && <p role="status" className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">{t('wf.statusReason', { reason: p.statusReason })}</p>}

      {tab === 'document' && <DocumentPanel proposalId={id} status={p.status} />}
      {tab === 'history' && <Timeline proposalId={id} />}

      <div className={tab === 'quote' ? 'space-y-6' : 'hidden'}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{t('quote.version', { n: q.versionNumber })} — {t(`quote.status.${q.status}`)}</span>
        {versions.data && versions.data.length > 1 && (
          <span className="opacity-70">{t('quote.versions')}: {versions.data.map((v) => `v${v.versionNumber}`).join(', ')}</span>
        )}
      </div>

      {readOnly && <p className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">{t('quote.locked')}</p>}

      {catalog.data && client.data ? (
        <QuoteEditor catalog={catalog.data} currency={q.currency} client={client.data} issuerCountry={ISSUER_COUNTRY}
          state={state} onChange={setState} readOnly={readOnly} showMargin={canSeeMargin} />
      ) : (
        <p>{t('common.loading')}</p>
      )}

      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      {errors.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-red-600">{errors.map((e, n) => <li key={n}>{e}</li>)}</ul>}

      <div className="flex flex-wrap gap-3">
        {!readOnly && (
          <>
            <Button onClick={() => save.mutate()} disabled={save.isPending || localInvalid}>{t('quote.save')}</Button>
            <Button variant="outline" onClick={() => lock.mutate()} disabled={lock.isPending || localInvalid || state.lines.length === 0}>{t('quote.lock')}</Button>
          </>
        )}
        {q.status === 'LOCKED' && <Button variant="outline" onClick={() => newVersion.mutate()} disabled={newVersion.isPending}>{t('quote.newVersion')}</Button>}
        {q.snapshotHash && <Button variant="ghost" onClick={() => check.mutate()}>{t('quote.verify')}</Button>}
      </div>

      {q.snapshotHash && (
        <p className="break-all font-mono text-xs opacity-70">{t('quote.hash')}: {q.snapshotHash}</p>
      )}
      {verify && <p role="status" className={verify.valid ? 'text-sm text-green-700' : 'text-sm text-red-600'}>{verify.valid ? t('quote.verified') : t('quote.notVerified')}</p>}
      </div>
    </section>
  );
}
