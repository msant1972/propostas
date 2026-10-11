import DOMPurify from 'dompurify';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { RichEditor } from '../components/RichEditor';
import { Badge, Button, Input, Label } from '../components/ui';
import { useAuth } from '../auth/store';
import { apiGet, apiPost } from '../lib/api';

type Block = components['schemas']['BlockDto'];
type Page = components['schemas']['BlockPageDto'];
type Tag = components['schemas']['MergeTagDto'];

const inAYear = () => new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
const blank = { code: '', title: '', isLegal: false, tags: '', language: 'pt-PT', reviewDueDate: inAYear(), bodyHtml: '<p></p>' };

export function ContentPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const roles = useAuth((s) => s.session?.user.roles ?? []);
  const canManage = roles.some((r) => ['Gestor_Comercial', 'Juridico', 'Administrador'].includes(r));
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [newBody, setNewBody] = useState<Record<string, string>>({});

  const list = useQuery({ queryKey: ['blocks', q, tag], queryFn: () => apiGet<Page>(`/content/blocks?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}`) });
  const tags = useQuery({ queryKey: ['merge-tags'], queryFn: () => apiGet<Tag[]>('/content/merge-tags') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['blocks'] });

  const create = useMutation({
    mutationFn: () => apiPost<Block>('/content/blocks', { ...form, tags: form.tags.split(',').map((x) => x.trim()).filter(Boolean) }),
    onSuccess: () => { refresh(); setCreating(false); setForm(blank); setError(null); },
    onError: (e: Error) => setError(e.message),
  });
  const act = useMutation({
    mutationFn: ({ id, path, body }: { id: string; path: string; body?: unknown }) => apiPost<Block>(`/content/blocks/${id}/${path}`, body),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  function submit(e: FormEvent) { e.preventDefault(); setError(null); create.mutate(); }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="mb-6 text-[28px] font-bold leading-tight sm:text-[32px]">{t('content.title')}</h1>
        {canManage && <Button onClick={() => setCreating(true)}>{t('content.new')}</Button>}
      </div>

      <div className="mb-4 flex gap-3">
        <Input aria-label={t('common.search')} placeholder={t('common.search')} className="max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <Input aria-label={t('content.searchTag')} placeholder={t('content.searchTag')} className="max-w-xs" value={tag} onChange={(e) => setTag(e.target.value)} />
      </div>

      {creating && (
        <form onSubmit={submit} className="mb-6 space-y-4 card p-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="b-code">{t('content.code')}</Label><Input id="b-code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></div>
            <div><Label htmlFor="b-title">{t('content.name')}</Label><Input id="b-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label htmlFor="b-tags">{t('content.tags')}</Label><Input id="b-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
            <div><Label htmlFor="b-lang">{t('content.language')}</Label><Input id="b-lang" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} /></div>
            <div><Label htmlFor="b-review">{t('content.review')}</Label><Input id="b-review" type="date" value={form.reviewDueDate} onChange={(e) => setForm({ ...form, reviewDueDate: e.target.value })} /></div>
            <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={form.isLegal} onChange={(e) => setForm({ ...form, isLegal: e.target.checked })} />{t('content.legal')}</label>
          </div>
          <div><Label htmlFor="b-body">{t('content.body')}</Label><RichEditor label={t('content.body')} html={form.bodyHtml} tags={tags.data} onChange={(h) => setForm({ ...form, bodyHtml: h })} /></div>
          {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
          <div className="flex gap-2"><Button type="submit" disabled={create.isPending}>{t('common.create')}</Button><Button type="button" variant="outline" onClick={() => setCreating(false)}>{t('common.cancel')}</Button></div>
        </form>
      )}
      {!creating && error && <p role="alert" className="mb-3 text-sm text-[var(--danger)]">{error}</p>}

      {list.isPending && <p>{t('common.loading')}</p>}
      {list.data && list.data.items.length === 0 && <p>{t('content.none')}</p>}
      <ul className="group-list">
        {list.data?.items.map((b) => (
          <li key={b.id}>
            <button className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
              <span><span className="font-medium">{b.title}</span> <span className="text-sm text-[var(--secondary)]">{b.code}</span>{b.isLegal && <Badge tone="orange" className="ml-2">{t('content.legal')}</Badge>}</span>
              <span className="text-xs text-[var(--secondary)]">{b.tags.join(', ')}</span>
            </button>
            {open === b.id && (
              <div className="mt-3 space-y-3">
                {b.versions.map((v) => (
                  <div key={v.id} className="rounded-[var(--radius)] bg-[var(--muted)] p-4 text-sm">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <strong>{t('content.version', { n: v.versionNumber })} · {v.language}</strong>
                      <span>{t(`content.status.${v.status}`)}</span>
                      <span className={v.reviewOverdue ? 'text-[var(--danger)]' : 'text-[var(--secondary)]'}>{t('content.review')} {v.reviewDueDate}{v.reviewOverdue ? ` — ${t('content.overdue')}` : ''}</span>
                      {canManage && v.status === 'DRAFT' && <Button variant="outline" onClick={() => act.mutate({ id: b.id, path: `versions/${v.id}/approve` })}>{t('content.approve')}</Button>}
                      {canManage && v.status === 'APPROVED' && <Button variant="ghost" onClick={() => act.mutate({ id: b.id, path: `versions/${v.id}/retire` })}>{t('content.retire')}</Button>}
                    </div>
                    <div className="prose-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(v.bodyHtml) }} />
                  </div>
                ))}
                {canManage && (
                  <div className="space-y-2">
                    <Label htmlFor={`nv-${b.id}`}>{t('content.newVersion')}</Label>
                    <RichEditor label={t('content.newVersion')} html={newBody[b.id] ?? b.versions[0]?.bodyHtml ?? '<p></p>'} tags={tags.data} onChange={(h) => setNewBody({ ...newBody, [b.id]: h })} />
                    <Button variant="outline" onClick={() => act.mutate({ id: b.id, path: 'versions', body: { language: b.versions[0]?.language ?? 'pt-PT', reviewDueDate: inAYear(), bodyHtml: newBody[b.id] ?? b.versions[0]?.bodyHtml ?? '<p></p>' } })}>{t('content.newVersion')}</Button>
                  </div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
