import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { getAccessToken } from '../auth/token';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../lib/api';
import { env } from '../lib/env';
import { RichEditor } from './RichEditor';
import { Button, Input, Select } from './ui';

type Section = components['schemas']['SectionDto'];
type Doc = components['schemas']['DocumentDto'];
type Block = components['schemas']['BlockDto'];
type BlockPage = components['schemas']['BlockPageDto'];
type Tag = components['schemas']['MergeTagDto'];
type Job = components['schemas']['JobStatusDto'];

async function download(proposalId: string, d: Doc) {
  const token = await getAccessToken();
  const res = await fetch(`${env.apiBase}/api/v1/proposals/${proposalId}/documents/${d.id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(res.statusText);
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: d.fileName });
  a.click();
  URL.revokeObjectURL(url);
}

function SectionEditor({ s, proposalId, editable, tags, first, last, onMove }: { s: Section; proposalId: string; editable: boolean; tags?: Tag[]; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [title, setTitle] = useState(s.title);
  const [html, setHtml] = useState(s.html);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setTitle(s.title); setHtml(s.html); }, [s.title, s.html, s.rowVersion]);

  const save = useMutation({
    mutationFn: () => apiPut<Section[]>(`/proposals/${proposalId}/sections/${s.id}`, { title, html, rowVersion: s.rowVersion }),
    onSuccess: (r) => { qc.setQueryData(['sections', proposalId], r); setMsg(null); },
    onError: (e: Error) => setMsg(e instanceof ApiError && e.status === 409 ? t('doc.conflict') : e.message),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`/proposals/${proposalId}/sections/${s.id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sections', proposalId] }),
  });
  const dirty = title !== s.title || html !== s.html;

  return (
    <li className="rounded-md border border-[var(--border)] p-3" data-testid="section">
      <div className="mb-2 flex items-center gap-2">
        <Input aria-label={t('doc.blankTitle')} disabled={!editable} value={title} onChange={(e) => setTitle(e.target.value)} className="font-medium" />
        {editable && (
          <>
            <Button variant="ghost" aria-label={t('doc.moveUp')} disabled={first} onClick={() => onMove(-1)}>↑</Button>
            <Button variant="ghost" aria-label={t('doc.moveDown')} disabled={last} onClick={() => onMove(1)}>↓</Button>
            <Button variant="ghost" onClick={() => remove.mutate()}>{t('common.delete')}</Button>
          </>
        )}
      </div>
      {s.blockCode && <p className="mb-2 text-xs opacity-60">{s.blockCode}{s.isModified && ` · ${t('doc.modified')}`}</p>}
      {s.isLegal && s.isModified && <p role="status" className="mb-2 text-sm text-amber-600">{t('doc.legalModified')}</p>}
      <RichEditor label={s.title} html={html} tags={tags} disabled={!editable} onChange={setHtml} />
      {msg && <p role="alert" className="mt-2 text-sm text-red-600">{msg}</p>}
      {editable && <Button className="mt-2" variant="outline" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{t('doc.saveSection')}</Button>}
    </li>
  );
}

export function DocumentPanel({ proposalId, status }: { proposalId: string; status: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const editable = status === 'DRAFT';
  const [pick, setPick] = useState('');
  const [blank, setBlank] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<'DOCX' | 'PDF'>('DOCX');

  const sections = useQuery({ queryKey: ['sections', proposalId], queryFn: () => apiGet<Section[]>(`/proposals/${proposalId}/sections`) });
  const docs = useQuery({ queryKey: ['documents', proposalId], queryFn: () => apiGet<Doc[]>(`/proposals/${proposalId}/documents`) });
  const blocks = useQuery({ queryKey: ['blocks', 'picker'], queryFn: () => apiGet<BlockPage>('/content/blocks?pageSize=100'), enabled: editable });
  const tags = useQuery({ queryKey: ['merge-tags'], queryFn: () => apiGet<Tag[]>('/content/merge-tags') });
  const job = useQuery({
    queryKey: ['job', jobId], enabled: !!jobId,
    queryFn: () => apiGet<Job>(`/proposals/${proposalId}/documents/jobs/${jobId}`),
    refetchInterval: (q) => (q.state.data && ['DONE', 'FAILED'].includes(q.state.data.status) ? false : 800),
  });
  useEffect(() => {
    if (job.data?.status === 'DONE') { void qc.invalidateQueries({ queryKey: ['documents', proposalId] }); setJobId(null); }
  }, [job.data?.status, proposalId, qc]);

  const add = useMutation({
    mutationFn: (body: { blockVersionId?: string; title?: string }) => apiPost<Section[]>(`/proposals/${proposalId}/sections`, body),
    onSuccess: (r) => { qc.setQueryData(['sections', proposalId], r); setPick(''); setBlank(''); setError(null); },
    onError: (e: Error) => setError(e.message),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => apiPut<Section[]>(`/proposals/${proposalId}/sections/order`, { orderedIds: ids }),
    onSuccess: (r) => qc.setQueryData(['sections', proposalId], r),
  });
  const compile = useMutation({
    mutationFn: () => apiPost<{ eventId: string }>(`/proposals/${proposalId}/documents/compile`),
    onSuccess: (r) => { setIssues([]); setError(null); setJobId(r.eventId); },
    onError: (e: Error) => {
      const body = e instanceof ApiError ? (e.body as { issues?: Array<{ tag: string; kind: string }> } | undefined) : undefined;
      setIssues(body?.issues?.map((i) => `{{${i.tag}}} — ${i.kind}`) ?? []);
      setError(e.message);
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const token = await getAccessToken();
      const res = await fetch(`${env.apiBase}/api/v1/proposals/${proposalId}/documents/upload?kind=${kind}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: file,
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { detail?: string }).detail ?? res.statusText);
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['documents', proposalId] }); if (fileRef.current) fileRef.current.value = ''; },
    onError: (e: Error) => setError(e.message),
  });

  const list = sections.data ?? [];
  const move = (i: number, dir: -1 | 1) => {
    const ids = list.map((s) => s.id);
    [ids[i], ids[i + dir]] = [ids[i + dir]!, ids[i]!];
    reorder.mutate(ids);
  };
  const generating = !!jobId && job.data?.status !== 'FAILED';

  return (
    <div className="space-y-6">
      <section aria-labelledby="sec-h">
        <h2 id="sec-h" className="mb-3 text-lg font-semibold">{t('doc.sections')}</h2>
        {!editable && <p className="mb-3 text-sm opacity-70">{t('doc.readonlyHint')}</p>}
        {list.length === 0 && <p className="mb-3 text-sm opacity-70">{t('doc.noSections')}</p>}
        <ul className="space-y-3">
          {list.map((s, i) => <SectionEditor key={s.id} s={s} proposalId={proposalId} editable={editable} tags={tags.data} first={i === 0} last={i === list.length - 1} onMove={(d) => move(i, d)} />)}
        </ul>
        {editable && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Select aria-label={t('doc.addFromLibrary')} className="max-w-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t('doc.pick')}</option>
              {blocks.data?.items.flatMap((b: Block) => b.versions.filter((v) => v.status === 'APPROVED').map((v) => <option key={v.id} value={v.id}>{b.title} ({v.language})</option>))}
            </Select>
            <Button variant="outline" disabled={!pick} onClick={() => add.mutate({ blockVersionId: pick })}>{t('doc.addFromLibrary')}</Button>
            <Input aria-label={t('doc.blankTitle')} placeholder={t('doc.blankTitle')} className="max-w-xs" value={blank} onChange={(e) => setBlank(e.target.value)} />
            <Button variant="outline" disabled={!blank} onClick={() => add.mutate({ title: blank })}>{t('doc.addBlank')}</Button>
          </div>
        )}
      </section>

      <section aria-labelledby="gen-h">
        <h2 id="gen-h" className="mb-3 text-lg font-semibold">{t('doc.documents')}</h2>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => compile.mutate()} disabled={generating || compile.isPending || list.length === 0 || !['DRAFT', 'IN_REVIEW'].includes(status)}>
            {generating ? t('doc.generating') : t('doc.generate')}
          </Button>
          {job.data?.status === 'FAILED' && <span role="alert" className="text-sm text-red-600">{t('doc.failed')}: {job.data.error}</span>}
        </div>
        {error && <p role="alert" className="mb-2 text-sm text-red-600">{error}</p>}
        {issues.length > 0 && <div className="mb-3 text-sm"><strong>{t('doc.issues')}</strong><ul className="list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul></div>}

        {docs.data && docs.data.length > 0 && (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-[var(--border)]"><th className="py-2">{t('quote.version', { n: '' }).trim()}</th><th>{t('doc.origin.GENERATED')}</th><th>{t('proposals.created')}</th><th /></tr></thead>
            <tbody>
              {docs.data.map((d) => (
                <tr key={d.id} className="border-b border-[var(--border)]">
                  <td className="py-2">{d.kind}</td><td>{t(`doc.origin.${d.origin}`)}</td><td>{d.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  <td className="text-right"><Button variant="ghost" onClick={() => void download(proposalId, d)}>{t('doc.download')} ({d.fileName})</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {['DRAFT', 'IN_REVIEW'].includes(status) && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span>{t('doc.upload')}:</span>
            <Select aria-label={t('doc.uploadKind')} className="w-24" value={kind} onChange={(e) => setKind(e.target.value as 'DOCX' | 'PDF')}><option>DOCX</option><option>PDF</option></Select>
            <input ref={fileRef} type="file" aria-label={t('doc.upload')} accept=".docx,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); }} />
          </div>
        )}
      </section>
    </div>
  );
}
