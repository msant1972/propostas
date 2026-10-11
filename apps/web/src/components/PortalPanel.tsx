import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { apiDelete, apiGet, apiPost } from '../lib/api';
import { Badge, Button, Card, Input, Label, SectionTitle, type Tone } from './ui';

type Link = components['schemas']['LinkDto'];
type Created = components['schemas']['LinkCreatedDto'];

const LINK_TONE: Record<string, Tone> = { ACTIVE: 'green', REVOKED: 'red', EXPIRED: 'gray', USED: 'blue' };

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
      {!sent && <p className="text-sm text-[var(--secondary)]">{t('portal.onlySent')}</p>}
      {sent && (
        <Card className="max-w-xl space-y-3">
          <div><Label htmlFor="pl-email">{t('portal.sendTo')}</Label><Input id="pl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="flex gap-2">
            <Button disabled={!email || create.isPending} onClick={() => create.mutate(email)}>{t('portal.send')}</Button>
            <Button variant="outline" disabled={create.isPending} onClick={() => create.mutate(undefined)}>{t('portal.createOnly')}</Button>
          </div>
          {created && (
            <div role="status" className="space-y-2 rounded-[var(--radius)] bg-[var(--fill)] p-3 text-sm">
              <p>{t('portal.urlOnce')}</p>
              <p className="break-all font-mono text-xs" data-testid="portal-url">{created.url}</p>
              <Button variant="outline" onClick={() => { void navigator.clipboard?.writeText(created.url); setCopied(true); }}>{copied ? t('portal.copied') : t('portal.copy')}</Button>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
        </Card>
      )}

      <div>
        <SectionTitle>{t('portal.links')}</SectionTitle>
        {links.data?.length === 0 && <p className="text-sm text-[var(--secondary)]">{t('portal.none')}</p>}
        <ul className="group-list text-sm">
          {links.data?.map((l) => (
            <li key={l.id} data-testid="link">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={LINK_TONE[l.status] ?? 'gray'}>{t(`portal.status.${l.status}`)}</Badge>
                <span>{t('portal.expires', { date: l.expiresAt.slice(0, 10) })}</span>
                <span className="text-[var(--secondary)]">{l.firstOpenedAt ? `${t('portal.opens', { n: l.openCount })} · ${l.lastOpenedAt?.slice(0, 16).replace('T', ' ')}` : t('portal.neverOpened')}</span>
                {l.status === 'ACTIVE' && <Button className="ml-auto" variant="ghost" onClick={() => revoke.mutate(l.id)}>{t('portal.revoke')}</Button>}
              </div>
              {l.response && <p className="mt-1 text-[var(--secondary)]">{t(`portal.response.${l.response.decision}`, { name: l.response.signerName, email: l.response.signerEmail })} · {l.response.decidedAt.slice(0, 16).replace('T', ' ')}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
