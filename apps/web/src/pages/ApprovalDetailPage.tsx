import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import type { components } from '@cpq/api-client';
import { Button, Input, Label } from '../components/ui';
import { getAccessToken } from '../auth/token';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { env } from '../lib/env';

type Detail = components['schemas']['ApprovalDetailDto'];

async function download(proposalId: string, docId: string, name: string) {
  const token = await getAccessToken();
  const res = await fetch(`${env.apiBase}/api/v1/proposals/${proposalId}/documents/${docId}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

export function ApprovalDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const q = useQuery({ queryKey: ['approval', id], queryFn: () => apiGet<Detail>(`/approvals/${id}`) });
  const decide = useMutation({
    mutationFn: (decision: 'APPROVED' | 'REJECTED' | 'RETURNED') => apiPost<Detail>(`/approvals/${id}/decision`, { decision, comment: comment || undefined }),
    onSuccess: (r) => { qc.setQueryData(['approval', id], r); setDone(true); setError(null); setComment(''); void qc.invalidateQueries({ queryKey: ['approvals'] }); },
    onError: (e: Error) => { setDone(false); setError(e instanceof ApiError ? e.message : t('common.error')); },
  });

  if (q.isPending) return <p>{t('common.loading')}</p>;
  if (q.isError) return <p role="alert">{t('common.error')}</p>;
  const r = q.data;
  const open = r.status === 'OPEN';

  return (
    <section className="space-y-6">
      <Link to="/aprovacoes" className="link text-sm">‹ {t('common.back')}</Link>
      <div>
        <h1 className="mb-1 text-[28px] font-bold leading-tight sm:text-[32px]">{r.proposalCode} — {r.proposalTitle}</h1>
        <p className="text-sm text-[var(--secondary)]">{r.clientName} · {t('approvals.owner')}: {r.ownerName} · {t(`approvals.scope.${r.scope}`)} · {t('approvals.policy')}: {r.policyName}</p>
      </div>

      <dl className="card card-pad grid max-w-xl grid-cols-[11rem_1fr] gap-y-2 text-sm [&>dt]:text-[var(--secondary)] [&>dd]:font-medium">
        <dt>{t('approvals.total')}</dt><dd>{r.grandTotal} {r.currency}</dd>
        <dt>{t('approvals.tcv')}</dt><dd>{r.tcv} {r.currency}</dd>
        <dt>{t('approvals.discount')}</dt><dd>{r.maxLineDiscountPercent} %</dd>
        <dt>{t('approvals.globalDiscount')}</dt><dd>{r.globalDiscountPercent} %</dd>
        {r.marginPercent !== null && (<><dt>{t('approvals.margin')}</dt><dd>{r.marginPercent} %</dd></>)}
        <dt>{t('approvals.level', { n: r.currentLevel, total: r.levelCount })}</dt><dd>{r.levelRole ? t(`roles.${r.levelRole}`, { defaultValue: r.levelRole }) : '—'}</dd>
      </dl>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{t('approvals.documents')}:</span>
        {r.pdfDocumentId && <Button variant="outline" onClick={() => void download(r.proposalId, r.pdfDocumentId!, `${r.proposalCode}.pdf`)}>{t('approvals.pdf')}</Button>}
        {r.docxDocumentId && <Button variant="outline" onClick={() => void download(r.proposalId, r.docxDocumentId!, `${r.proposalCode}.docx`)}>{t('approvals.docx')}</Button>}
        <Link className="link" to={`/propostas/${r.proposalId}`}>{t('approvals.proposal')}</Link>
      </div>
      <p className="break-all font-mono text-xs text-[var(--secondary)]">{t('approvals.hash')}: {r.snapshotHash}</p>

      <div>
        <h2 className="mb-3 text-lg font-semibold">{t('approvals.decisions')}</h2>
        {r.decisions.length === 0 && <p className="text-sm text-[var(--secondary)]">—</p>}
        <ul className="group-list text-sm">
          {r.decisions.map((d, i) => (
            <li key={i}>
              {t('approvals.level', { n: d.level, total: r.levelCount })}: <strong>{d.decision}</strong> — {d.approverName}
              {d.onBehalfOfName ? ` (${t('approvals.onBehalf', { name: d.onBehalfOfName })})` : ''} · {d.decidedAt.slice(0, 16).replace('T', ' ')}{d.comment ? ` · ${d.comment}` : ''}
            </li>
          ))}
        </ul>
      </div>

      {open && r.canDecide && (
        <div className="card card-pad max-w-xl space-y-3">
          <div><Label htmlFor="cm">{t('approvals.comment')}</Label><Input id="cm" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
          <div className="flex gap-2">
            <Button onClick={() => decide.mutate('APPROVED')} disabled={decide.isPending}>{t('approvals.approve')}</Button>
            <Button variant="outline" onClick={() => decide.mutate('RETURNED')} disabled={decide.isPending || !comment.trim()}>{t('approvals.return')}</Button>
            <Button variant="danger" onClick={() => decide.mutate('REJECTED')} disabled={decide.isPending || !comment.trim()}>{t('approvals.reject')}</Button>
          </div>
        </div>
      )}
      {open && !r.canDecide && <p className="text-sm text-[var(--secondary)]">{t('approvals.cannotDecide')}</p>}
      {!open && <p className="text-sm text-[var(--secondary)]">{t('approvals.closed')}</p>}
      {done && <p role="status" className="text-sm text-[var(--success)]">{t('approvals.decided')}</p>}
      {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
    </section>
  );
}
