import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { apiGet } from '../lib/api';

type Entry = components['schemas']['TimelineEntryDto'];

export function Timeline({ proposalId }: { proposalId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['timeline', proposalId], queryFn: () => apiGet<Entry[]>(`/proposals/${proposalId}/timeline`), refetchInterval: 3000 });
  if (!q.data) return <p>{t('common.loading')}</p>;
  if (q.data.length === 0) return <p className="text-sm text-[var(--secondary)]">{t('wf.noHistory')}</p>;
  const label = (e: Entry) => {
    const d = e.detail as Record<string, unknown>;
    const text = t(`wf.action.${e.action}`, { defaultValue: e.action, from: d['from'] ? t(`status.${String(d['from'])}`) : '', to: d['to'] ? t(`status.${String(d['to'])}`) : '', scope: d['scope'] ? t(`approvals.scope.${String(d['scope'])}`) : '', level: d['level'] as number });
    return text;
  };
  return (
    <ol className="card card-pad space-y-4">
      {q.data.map((e, i) => (
        <li key={i} className="relative border-l-2 border-[var(--separator)] pl-4 text-sm">
          <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-[var(--primary)] ring-4 ring-[var(--surface)]" />
          <div className="font-medium">{label(e)}</div>
          <div className="text-[var(--secondary)]">
            {e.occurredAt.slice(0, 16).replace('T', ' ')}{e.actorName ? ` · ${t('wf.by', { name: e.actorName })}` : ''}
            {typeof e.detail['reason'] === 'string' && e.detail['reason'] ? ` · ${t('wf.statusReason', { reason: e.detail['reason'] })}` : ''}
            {typeof e.detail['comment'] === 'string' && e.detail['comment'] ? ` · ${e.detail['comment']}` : ''}
          </div>
        </li>
      ))}
    </ol>
  );
}
