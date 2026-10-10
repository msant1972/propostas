import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { apiGet } from '../lib/api';

type Entry = components['schemas']['TimelineEntryDto'];

export function Timeline({ proposalId }: { proposalId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['timeline', proposalId], queryFn: () => apiGet<Entry[]>(`/proposals/${proposalId}/timeline`), refetchInterval: 3000 });
  if (!q.data) return <p>{t('common.loading')}</p>;
  if (q.data.length === 0) return <p className="text-sm opacity-70">{t('wf.noHistory')}</p>;
  const label = (e: Entry) => {
    const d = e.detail as Record<string, unknown>;
    const text = t(`wf.action.${e.action}`, { defaultValue: e.action, from: d['from'] ? t(`status.${String(d['from'])}`) : '', to: d['to'] ? t(`status.${String(d['to'])}`) : '', scope: d['scope'] ? t(`approvals.scope.${String(d['scope'])}`) : '', level: d['level'] as number });
    return text;
  };
  return (
    <ol className="space-y-3 border-l border-[var(--border)] pl-4">
      {q.data.map((e, i) => (
        <li key={i} className="relative text-sm">
          <span className="absolute -left-[1.35rem] top-1.5 h-2 w-2 rounded-full bg-[var(--primary)]" />
          <div className="font-medium">{label(e)}</div>
          <div className="opacity-70">
            {e.occurredAt.slice(0, 16).replace('T', ' ')}{e.actorName ? ` · ${t('wf.by', { name: e.actorName })}` : ''}
            {typeof e.detail['reason'] === 'string' && e.detail['reason'] ? ` · ${t('wf.statusReason', { reason: e.detail['reason'] })}` : ''}
            {typeof e.detail['comment'] === 'string' && e.detail['comment'] ? ` · ${e.detail['comment']}` : ''}
          </div>
        </li>
      ))}
    </ol>
  );
}
