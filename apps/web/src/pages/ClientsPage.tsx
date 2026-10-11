import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { Button, Input, Label } from '../components/ui';
import { apiDelete, apiGet, apiPatch, apiPost } from '../lib/api';

type Client = components['schemas']['ClientDto'];
type Page = components['schemas']['ClientPageDto'];

const empty = { code: '', name: '', vatNumber: '', countryCode: 'PT', tier: '', vatValid: false, contactName: '', contactEmail: '' };

export function ClientsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['clients', q, page],
    queryFn: () => apiGet<Page>(`/clients?page=${page}&pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: form.code, name: form.name, countryCode: form.countryCode.toUpperCase(),
        vatNumber: form.vatNumber || undefined, tier: form.tier || undefined, vatValid: form.vatValid,
        contactName: form.contactName || undefined, contactEmail: form.contactEmail || undefined,
      };
      return editing === 'new' ? apiPost('/clients', body) : apiPatch(`/clients/${(editing as Client).id}`, body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] });
      setEditing(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete(`/clients/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['clients'] }),
  });

  function open(c: Client | 'new') {
    setError(null);
    setEditing(c);
    setForm(c === 'new' ? empty : { code: c.code, name: c.name, vatNumber: c.vatNumber ?? '', countryCode: c.countryCode, tier: c.tier ?? '', vatValid: c.vatValid, contactName: c.contactName ?? '', contactEmail: c.contactEmail ?? '' });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    save.mutate();
  }

  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('clients.title')}</h1>
        <Button onClick={() => open('new')}>{t('clients.new')}</Button>
      </div>

      <Input aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="mb-4 max-w-sm" />

      {editing && (
        <form onSubmit={submit} className="mb-6 grid max-w-2xl grid-cols-2 gap-4 rounded-md border border-[var(--border)] p-4">
          <div><Label htmlFor="c-code">{t('clients.code')}</Label><Input id="c-code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
          <div><Label htmlFor="c-name">{t('clients.name')}</Label><Input id="c-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label htmlFor="c-vat">{t('clients.vat')}</Label><Input id="c-vat" value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} /></div>
          <div><Label htmlFor="c-country">{t('clients.country')}</Label><Input id="c-country" required maxLength={2} value={form.countryCode} onChange={(e) => setForm({ ...form, countryCode: e.target.value })} /></div>
          <div><Label htmlFor="c-tier">{t('clients.tier')}</Label><Input id="c-tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} /></div>
          <div><Label htmlFor="c-cn">{t('clients.contactName')}</Label><Input id="c-cn" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></div>
          <div><Label htmlFor="c-ce">{t('clients.contactEmail')}</Label><Input id="c-ce" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></div>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={form.vatValid} onChange={(e) => setForm({ ...form, vatValid: e.target.checked })} />{t('clients.vatValid')}</label>
          {error && <p role="alert" className="col-span-2 text-sm text-red-600">{error}</p>}
          <div className="col-span-2 flex gap-2">
            <Button type="submit" disabled={save.isPending}>{t('common.save')}</Button>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}

      {list.isPending && <p>{t('common.loading')}</p>}
      {list.isError && <p role="alert">{t('common.error')}</p>}
      {list.data && list.data.items.length === 0 && <p>{t('common.empty')}</p>}
      {list.data && list.data.items.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-[var(--border)]"><th className="py-2">{t('clients.code')}</th><th>{t('clients.name')}</th><th>{t('clients.vat')}</th><th>{t('clients.country')}</th><th>{t('clients.tier')}</th><th /></tr></thead>
          <tbody>
            {list.data.items.map((c) => (
              <tr key={c.id} className="border-b border-[var(--border)]">
                <td className="py-2">{c.code}</td><td>{c.name}</td><td>{c.vatNumber ?? '—'}</td><td>{c.countryCode}</td><td>{c.tier ?? '—'}</td>
                <td className="space-x-2 text-right">
                  <Button variant="ghost" onClick={() => open(c)}>{t('common.edit')}</Button>
                  <Button variant="ghost" onClick={() => { if (confirm(t('clients.confirmDelete'))) remove.mutate(c.id); }}>{t('common.delete')}</Button>
                </td>
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
