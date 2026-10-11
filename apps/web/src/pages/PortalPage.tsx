import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import type { components } from '@cpq/api-client';
import { Button, Input, Label } from '../components/ui';
import { env } from '../lib/env';

type View = components['schemas']['PortalViewDto'];

class NotFound extends Error {}

async function load(token: string): Promise<View> {
  const res = await fetch(`${env.apiBase}/api/v1/portal/${token}`);
  if (res.status === 404) throw new NotFound();
  if (!res.ok) throw new Error(res.statusText);
  return (await res.json()) as View;
}

/** Página pública do cliente: não exige conta; o acesso é a própria ligação (token). */
export function PortalPage() {
  const { t } = useTranslation();
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['portal', token], queryFn: () => load(token), retry: false });
  const [decision, setDecision] = useState<'ACCEPTED' | 'DECLINED'>('ACCEPTED');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [read, setRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${env.apiBase}/api/v1/portal/${token}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, signerName: name, signerEmail: email, comment: comment || undefined, confirmRead: read }),
      });
      if (!res.ok) {
        const p = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(p.detail ?? t('portal.public.error'));
      }
      qc.setQueryData(['portal', token], (await res.json()) as View);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (q.isPending) return <main className="p-8 text-center text-[var(--secondary)]">{t('common.loading')}</main>;
  if (q.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="enter glass max-w-md rounded-[22px] p-10 text-center shadow-[var(--shadow-lg)]">
          <div aria-hidden="true" className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--warning-soft)] text-xl text-[var(--warning)]">!</div>
          <h1 className="text-xl font-semibold">{t('portal.public.invalid')}</h1>
        </div>
      </main>
    );
  }
  const v = q.data;
  const finalTone = v.state === 'ACCEPTED' ? 'ok' : v.state === 'DECLINED' ? 'no' : 'closed';

  return (
    <div className="min-h-screen">
      <div className="navbar">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3 sm:px-6">
          <span className="text-[15px] font-semibold tracking-tight">{t('app.title')}</span>
          <span className="text-[13px] text-[var(--secondary)]">{v.proposalCode}</span>
        </div>
      </div>
      <main className="enter mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-6 sm:py-12">
        <header className="text-center sm:text-left">
          <h1 className="text-[32px] font-bold leading-tight sm:text-[44px]">{v.proposalTitle}</h1>
          <p className="mt-2 text-[17px] text-[var(--secondary)]">{t('portal.public.for', { client: v.clientName })}{v.validUntil ? ` · ${t('portal.public.validUntil', { date: v.validUntil })}` : ''}</p>
          <p className="card card-pad mt-6 inline-block text-left text-[15px] text-[var(--secondary)]">{t('portal.public.total')}: <strong className="ml-1 text-[24px] font-semibold tabular-nums text-[var(--foreground)]">{v.grandTotal} {v.currency}</strong></p>
        </header>

        <section aria-label={t('portal.public.document')}>
          <iframe title={t('portal.public.document')} src={`${env.apiBase}/api/v1/portal/${token}/document`} className="h-[75vh] w-full rounded-[var(--radius-lg)] bg-white shadow-[var(--shadow-lg)]" />
          <p className="mt-3 break-all px-1 font-mono text-xs text-[var(--secondary)]">{t('portal.public.hash')}: {v.documentSha256}</p>
        </section>

        {v.certificateFingerprint && (
          <section className="card card-pad text-sm">
            <h2 className="font-semibold">{t('portal.public.certTitle')}</h2>
            <p className="mt-1 text-[var(--secondary)]">{t('portal.public.certText')}</p>
            <p className="mt-2 break-all font-mono text-xs" data-testid="fingerprint">{v.certificateFingerprint}</p>
          </section>
        )}

        {v.state === 'OPEN' && (
          <form onSubmit={(e) => void submit(e)} className="card card-pad mx-auto max-w-xl space-y-5 !p-6 shadow-[var(--shadow-md)]">
            <h2 className="text-[22px] font-semibold">{t('portal.public.answer')}</h2>
            <div className="segmented w-full" role="radiogroup">
              <label className={`flex-1 cursor-pointer rounded-[8px] px-3 py-2 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--ring)] text-center text-sm font-medium transition-colors ${decision === 'ACCEPTED' ? 'bg-[var(--surface)] shadow-[0_1px_3px_rgba(0,0,0,.18)]' : ''}`}>
                <input className="sr-only" type="radio" name="decision" checked={decision === 'ACCEPTED'} onChange={() => setDecision('ACCEPTED')} />{t('portal.public.accept')}
              </label>
              <label className={`flex-1 cursor-pointer rounded-[8px] px-3 py-2 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-[var(--ring)] text-center text-sm font-medium transition-colors ${decision === 'DECLINED' ? 'bg-[var(--surface)] shadow-[0_1px_3px_rgba(0,0,0,.18)]' : ''}`}>
                <input className="sr-only" type="radio" name="decision" checked={decision === 'DECLINED'} onChange={() => setDecision('DECLINED')} />{t('portal.public.decline')}
              </label>
            </div>
            <div><Label htmlFor="pn">{t('portal.public.name')}</Label><Input id="pn" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label htmlFor="pe">{t('portal.public.email')}</Label><Input id="pe" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label htmlFor="pc">{t('portal.public.comment')}</Label><Input id="pc" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
            {decision === 'ACCEPTED' && <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" className="mt-0.5" checked={read} onChange={(e) => setRead(e.target.checked)} />{t('portal.public.read')}</label>}
            {error && <p role="alert" className="rounded-[10px] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}
            <Button type="submit" className="w-full min-h-11 text-base" disabled={busy || (decision === 'ACCEPTED' && !read)}>{t('portal.public.submit')}</Button>
          </form>
        )}

        {v.state !== 'OPEN' && (
          <section role="status" className="card pop mx-auto max-w-xl p-8 text-center shadow-[var(--shadow-md)]">
            <div aria-hidden="true" className={`pop mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full text-3xl font-bold ${finalTone === 'ok' ? 'bg-[var(--success-soft)] text-[var(--success)]' : finalTone === 'no' ? 'bg-[var(--danger-soft)] text-[var(--danger)]' : 'bg-[var(--fill)] text-[var(--secondary)]'}`}>
              {finalTone === 'ok' ? '✓' : finalTone === 'no' ? '✕' : '–'}
            </div>
            <h2 className="text-[24px] font-semibold">{v.state === 'ACCEPTED' ? t('portal.public.accepted') : v.state === 'DECLINED' ? t('portal.public.declined') : t('portal.public.closed')}</h2>
            {v.response && <p className="mt-2 text-sm">{t('portal.public.by', { name: v.response.signerName, date: v.response.decidedAt.slice(0, 16).replace('T', ' ') })}</p>}
            {v.response && <p className="mt-1 text-sm text-[var(--secondary)]">{t('portal.public.receipt')}</p>}
          </section>
        )}
      </main>
    </div>
  );
}
