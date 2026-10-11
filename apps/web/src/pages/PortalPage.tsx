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

  if (q.isPending) return <main className="p-8">{t('common.loading')}</main>;
  if (q.isError) {
    return (
      <main className="mx-auto mt-24 max-w-md px-4 text-center">
        <h1 className="text-xl font-semibold">{t('portal.public.invalid')}</h1>
      </main>
    );
  }
  const v = q.data;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <header>
        <p className="text-sm opacity-70">{v.proposalCode}</p>
        <h1 className="text-3xl font-semibold">{v.proposalTitle}</h1>
        <p className="mt-1 opacity-80">{t('portal.public.for', { client: v.clientName })}{v.validUntil ? ` · ${t('portal.public.validUntil', { date: v.validUntil })}` : ''}</p>
        <p className="mt-1 text-lg">{t('portal.public.total')}: <strong>{v.grandTotal} {v.currency}</strong></p>
      </header>

      <section aria-label={t('portal.public.document')}>
        <iframe title={t('portal.public.document')} src={`${env.apiBase}/api/v1/portal/${token}/document`} className="h-[70vh] w-full rounded-md border border-[var(--border)]" />
        <p className="mt-2 break-all font-mono text-xs opacity-60">{t('portal.public.hash')}: {v.documentSha256}</p>
      </section>

      {v.certificateFingerprint && (
        <section className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-4 text-sm">
          <h2 className="font-semibold">{t('portal.public.certTitle')}</h2>
          <p>{t('portal.public.certText')}</p>
          <p className="mt-1 break-all font-mono text-xs" data-testid="fingerprint">{v.certificateFingerprint}</p>
        </section>
      )}

      {v.state === 'OPEN' && (
        <form onSubmit={(e) => void submit(e)} className="max-w-xl space-y-4 rounded-md border border-[var(--border)] p-4">
          <h2 className="text-lg font-semibold">{t('portal.public.answer')}</h2>
          <div className="flex gap-6">
            <label className="flex items-center gap-2"><input type="radio" name="decision" checked={decision === 'ACCEPTED'} onChange={() => setDecision('ACCEPTED')} />{t('portal.public.accept')}</label>
            <label className="flex items-center gap-2"><input type="radio" name="decision" checked={decision === 'DECLINED'} onChange={() => setDecision('DECLINED')} />{t('portal.public.decline')}</label>
          </div>
          <div><Label htmlFor="pn">{t('portal.public.name')}</Label><Input id="pn" required minLength={2} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label htmlFor="pe">{t('portal.public.email')}</Label><Input id="pe" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label htmlFor="pc">{t('portal.public.comment')}</Label><Input id="pc" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          {decision === 'ACCEPTED' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />{t('portal.public.read')}</label>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <Button type="submit" disabled={busy || (decision === 'ACCEPTED' && !read)}>{t('portal.public.submit')}</Button>
        </form>
      )}

      {v.state !== 'OPEN' && (
        <section role="status" className="rounded-md border border-[var(--border)] bg-[var(--muted)] p-4">
          <h2 className="text-lg font-semibold">{v.state === 'ACCEPTED' ? t('portal.public.accepted') : v.state === 'DECLINED' ? t('portal.public.declined') : t('portal.public.closed')}</h2>
          {v.response && <p className="text-sm">{t('portal.public.by', { name: v.response.signerName, date: v.response.decidedAt.slice(0, 16).replace('T', ' ') })}</p>}
          {v.response && <p className="text-sm opacity-70">{t('portal.public.receipt')}</p>}
        </section>
      )}
    </main>
  );
}
