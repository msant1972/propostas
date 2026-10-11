import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { Button, Input, Label } from '../components/ui';
import { apiDelete, apiGet, apiPost } from '../lib/api';

type Key = components['schemas']['ApiKeyDto'];
type Created = components['schemas']['ApiKeyCreatedDto'];
type Anon = components['schemas']['AnonymizeResultDto'];

export function IntegrationsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['clients:write', 'proposals:read']);
  const [created, setCreated] = useState<Created | null>(null);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => apiGet<Key[]>('/api-keys') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['api-keys'] });
  const fail = (e: Error) => { setMessage(null); setError(e.message); };

  const create = useMutation({ mutationFn: () => apiPost<Created>('/api-keys', { name, scopes }), onSuccess: (r) => { setCreated(r); setName(''); setError(null); refresh(); }, onError: fail });
  const revoke = useMutation({ mutationFn: (id: string) => apiDelete(`/api-keys/${id}`), onSuccess: refresh, onError: fail });
  const exportData = useMutation({
    mutationFn: () => apiPost<object>('/privacy/export', { email }),
    onSuccess: (r) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `dados-${email}.json` }).click();
      URL.revokeObjectURL(url);
      setError(null); setMessage(t('integrations.exported'));
    },
    onError: fail,
  });
  const anonymize = useMutation({
    mutationFn: () => apiPost<Anon>('/privacy/anonymize', { email, confirm: true }),
    onSuccess: (r) => { setError(null); setMessage(t('integrations.anonymized', { clients: r.clients, responses: r.customerResponses, users: r.users })); },
    onError: fail,
  });

  const toggle = (s: string) => setScopes(scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s]);

  return (
    <section className="space-y-10">
      <div>
        <h1 className="mb-2 text-2xl font-semibold">{t('integrations.title')}</h1>
        <p className="text-sm opacity-70">{t('integrations.docs')}</p>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">{t('integrations.keys')}</h2>
        {created && (
          <div role="status" className="mb-3 rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
            <p>{t('integrations.keyOnce')}</p>
            <p className="mt-1 break-all font-mono text-xs" data-testid="api-key">{created.key}</p>
            <Button className="mt-2" variant="outline" onClick={() => setCreated(null)}>{t('common.cancel')}</Button>
          </div>
        )}
        <ul className="mb-4 space-y-1 text-sm">
          {keys.data?.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{k.name}</span><span className="font-mono text-xs opacity-70">{k.prefix}…</span><span>{k.scopes.join(', ')}</span>
              <span className="opacity-60">{t('integrations.lastUsed')}: {k.lastUsedAt ? k.lastUsedAt.slice(0, 16).replace('T', ' ') : t('integrations.neverUsed')}</span>
              {k.revokedAt ? <span className="text-red-600">{t('integrations.revoked')}</span> : <Button variant="ghost" onClick={() => revoke.mutate(k.id)}>{t('integrations.revoke')}</Button>}
            </li>
          ))}
        </ul>
        <div className="flex max-w-xl flex-wrap items-end gap-3">
          <div className="grow"><Label htmlFor="k-name">{t('integrations.keyName')}</Label><Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={scopes.includes('clients:write')} onChange={() => toggle('clients:write')} />{t('integrations.clientsWrite')}</label>
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={scopes.includes('proposals:read')} onChange={() => toggle('proposals:read')} />{t('integrations.proposalsRead')}</label>
          <Button disabled={!name.trim() || scopes.length === 0 || create.isPending} onClick={() => create.mutate()}>{t('integrations.create')}</Button>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">{t('integrations.privacy')}</h2>
        <div className="flex max-w-xl flex-wrap items-end gap-3">
          <div className="grow"><Label htmlFor="pv-email">{t('integrations.email')}</Label><Input id="pv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <Button variant="outline" disabled={!email} onClick={() => exportData.mutate()}>{t('integrations.export')}</Button>
          <Button variant="outline" disabled={!email} onClick={() => { if (confirm(t('integrations.confirm'))) anonymize.mutate(); }}>{t('integrations.anonymize')}</Button>
        </div>
        {message && <p role="status" className="mt-2 text-sm text-green-700">{message}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
