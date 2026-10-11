import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { components } from '@cpq/api-client';
import { Button, Input, Label, Select } from '../components/ui';
import { hasRole, useAuth } from '../auth/store';
import { apiDelete, apiGet, apiPost } from '../lib/api';

type Summary = components['schemas']['ApprovalSummaryDto'];
type Delegation = components['schemas']['DelegationDto'];
type Target = components['schemas']['UserOptionDto'];

const today = () => new Date().toISOString().slice(0, 10);
const plus = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

export function ApprovalsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const admin = hasRole(useAuth((s) => s.session), 'Administrador');
  const [all, setAll] = useState(false);
  const [to, setTo] = useState('');
  const [from, setFrom] = useState(today());
  const [until, setUntil] = useState(plus(7));
  const [error, setError] = useState<string | null>(null);

  const inbox = useQuery({ queryKey: ['approvals', all], queryFn: () => apiGet<Summary[]>(`/approvals${all ? '?all=true' : ''}`), refetchInterval: 10_000 });
  const delegations = useQuery({ queryKey: ['delegations'], queryFn: () => apiGet<Delegation[]>('/delegations') });
  const targets = useQuery({ queryKey: ['delegation-targets'], queryFn: () => apiGet<Target[]>('/delegations/targets') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['delegations'] });
  const add = useMutation({ mutationFn: () => apiPost<Delegation>('/delegations', { toUserId: to, validFrom: from, validTo: until }), onSuccess: () => { setError(null); setTo(''); refresh(); }, onError: (e: Error) => setError(e.message) });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/delegations/${id}`), onSuccess: refresh });

  return (
    <section className="space-y-8">
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{t('approvals.title')}</h1>
          {admin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />{t('approvals.all')}</label>}
        </div>
        {inbox.isPending && <p>{t('common.loading')}</p>}
        {inbox.data?.length === 0 && <p className="text-sm opacity-70">{t('approvals.none')}</p>}
        <ul className="space-y-3">
          {inbox.data?.map((r) => (
            <li key={r.id} className="rounded-md border border-[var(--border)] p-3 text-sm" data-testid="approval">
              <div className="flex flex-wrap items-center gap-3">
                <Link className="font-medium underline" to={`/aprovacoes/${r.id}`}>{r.proposalCode} — {r.proposalTitle}</Link>
                <span className="opacity-70">{r.clientName}</span>
                <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs">{t(`approvals.scope.${r.scope}`)}</span>
                <span className="ml-auto">{r.grandTotal} {r.currency}</span>
              </div>
              <div className="mt-1 opacity-70">
                {t('approvals.level', { n: r.currentLevel, total: r.levelCount })} · {r.levelRole ? t(`roles.${r.levelRole}`, { defaultValue: r.levelRole }) : ''}
                {r.dueAt && <> · {t('approvals.due')}: {r.dueAt.slice(0, 16).replace('T', ' ')}</>}
                {r.overdue && <span className="ml-2 text-red-600">{t('approvals.overdue')}</span>}
                {!r.canDecide && <span className="ml-2">({t('approvals.cannotDecide')})</span>}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">{t('approvals.delegations')}</h2>
        <ul className="mb-3 space-y-1 text-sm">
          {delegations.data?.map((d) => (
            <li key={d.id} className="flex items-center gap-3">{d.toUserName} · {d.validFrom} → {d.validTo}<Button variant="ghost" onClick={() => remove.mutate(d.id)}>{t('common.delete')}</Button></li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <div><Label htmlFor="d-to">{t('approvals.delegateTo')}</Label>
            <Select id="d-to" className="w-56" value={to} onChange={(e) => setTo(e.target.value)}><option value="" />{targets.data?.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</Select></div>
          <div><Label htmlFor="d-from">{t('approvals.from')}</Label><Input id="d-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><Label htmlFor="d-until">{t('approvals.to')}</Label><Input id="d-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          <Button variant="outline" disabled={!to} onClick={() => add.mutate()}>{t('approvals.add')}</Button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </section>
  );
}
