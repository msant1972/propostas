import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { Button, Input, Label } from './ui';

type Link = components['schemas']['LinkDto'];
type Created = components['schemas']['LinkCreatedDto'];

export function PortalPanel({ proposalId, status, contactEmail }: { proposalId: string; status: string; contactEmail: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [email, setEmail] = useState(contactEmail ?? '');
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sent = status === 'SENT';

  const links = useQuery({ queryKey: ['links', proposalId], queryFn: () => apiGet<Link[]>(`/proposals/${proposalId}/share-links`), refetchInterval: 5000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['links', proposalId] });
  const create = useMutation({
    mutationFn: (sendTo?: string) => apiPost<Created>(`/proposals/${proposalId}/share-links`, { sendTo }),
    onSuccess: (r) => { setCreated(r); setCopied(false); setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const revoke = useMutation({ mutationFn: (id: string) => apiDelete(`/proposals/${proposalId}/share-links/${id}`), onSuccess: refresh });

  return (
    <div className="space-y-6">
      {!sent && <p className="text-sm opacity-70">{t('portal.onlySent')}</p>}
      {sent && (
        <div className="max-w-xl space-y-3 rounded-md border border-[var(--border)] p-4">
          <div><Label htmlFor="pl-email">{t('portal.sendTo')}</Label><Input id="pl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="flex gap-2">
            <Button disabled={!email || create.isPending} onClick={() => create.mutate(email)}>{t('portal.send')}</Button>
            <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate(undefined)}>{t('portal.createOnly')}</Button>
          </div>
          {created && (
            <div role="status" className="space-y-2 rounded bg-[var(--muted)] p-3 text-sm">
              <p>{t('portal.urlOnce')}</p>
              <p className="break-all font-mono text-xs" data-testid="portal-url">{created.url}</p>
              <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(created.url); setCopied(true); }}>{copied ? t('portal.copied') : t('portal.copy')}</Button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-semibold">{t('portal.links')}</h2>
        {links.data?.length === 0 && <p className="text-sm opacity-70">{t('portal.none')}</p>}
        <ul className="space-y-2 text-sm">
          {links.data?.map((l) => (
            <li key={l.id} className="rounded-md border border-[var(--border)] p-3" data-testid="link">
              <div className="flex flex-wrap items-center gap-3">
                <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs">{t(`portal.status.${l.status}`)}</span>
                <span>{t('portal.expires', { date: l.expiresAt.slice(0, 10) })}</span>
                <span className="opacity-70">{l.firstOpenedAt ? `${t('portal.opens', { n: l.openCount })} · ${l.lastOpenedAt?.slice(0, 16).replace('T', ' ')}` : t('portal.neverOpened')}</span>
                {l.status === 'ACTIVE' && <Button className="ml-auto" variant="ghost" onClick={() => revoke.mutate(l.id)}>{t('portal.revoke')}</Button>}
              </div>
              {l.response && <p className="mt-1">{t(`portal.response.${l.response.decision}`, { name: l.response.signerName, email: l.response.signerEmail })} · {l.response.decidedAt.slice(0, 16).replace('T', ' ')}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
