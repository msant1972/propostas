import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import type { components } from '@cpq/api-client';
import { Button, Input, Label, Select } from '../components/ui';
import { apiGet, apiPost } from '../lib/api';

type Proposal = components['schemas']['ProposalDto'];
type ProposalPage = components['schemas']['ProposalPageDto'];
type ClientPage = components['schemas']['ClientPageDto'];

export function ProposalsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', clientId: '', currency: 'EUR' });
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['proposals', q, status, page],
    queryFn: () => apiGet<ProposalPage>(`/proposals?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}${status ? `&status=${status}` : ''}`),
  });
  const clients = useQuery({ queryKey: ['clients', 'all'], queryFn: () => apiGet<ClientPage>('/clients?page=1&pageSize=100'), enabled: creating });

  const create = useMutation({
    mutationFn: () => apiPost<Proposal>('/proposals', form),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['proposals'] });
      navigate(`/propostas/${p.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('proposals.title')}</h1>
        <Button onClick={() => setCreating(true)}>{t('proposals.new')}</Button>
      </div>

      {creating && (
        <form onSubmit={submit} className="mb-6 grid max-w-2xl grid-cols-2 gap-4 rounded-md border border-[var(--border)] p-4">
          <div className="col-span-2"><Label htmlFor="p-title">{t('proposals.name')}</Label><Input id="p-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div>
            <Label htmlFor="p-client">{t('proposals.client')}</Label>
            <Select id="p-client" required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
              <option value="">{t('proposals.selectClient')}</option>
              {clients.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div><Label htmlFor="p-cur">{t('proposals.currency')}</Label><Input id="p-cur" maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
          {error && <p role="alert" className="col-span-2 text-sm text-red-600">{error}</p>}
          <div className="col-span-2 flex gap-2">
            <Button type="submit" disabled={create.isPending}>{t('common.create')}</Button>
            <Button type="button" variant="outline" onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}

      <div className="mb-4 flex gap-3">
        <Input aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-sm" />
        <Select aria-label={t('proposals.status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="max-w-xs">
          <option value="">{t('proposals.status')}</option>
          {['DRAFT', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED'].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
      </div>

      {list.isPending && <p>{t('common.loading')}</p>}
      {list.isError && <p role="alert">{t('common.error')}</p>}
      {list.data && list.data.items.length === 0 && <p>{t('common.empty')}</p>}
      {list.data && list.data.items.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-[var(--border)]"><th className="py-2">{t('proposals.code')}</th><th>{t('proposals.name')}</th><th>{t('proposals.status')}</th><th>{t('proposals.currency')}</th><th>{t('proposals.created')}</th></tr></thead>
          <tbody>
            {list.data.items.map((p) => (
              <tr key={p.id} className="border-b border-[var(--border)]">
                <td className="py-2">{p.code}</td>
                <td><Link className="underline" to={`/propostas/${p.id}`}>{p.title}</Link></td>
                <td>{t(`status.${p.status}`)}</td><td>{p.currency}</td><td>{p.createdAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.data && (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.previous')}</Button>
          <span>{page} / {pages}</span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('common.next')}</Button>
        </div>
      )}
    </section>
  );
}
