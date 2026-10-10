import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { Button, Input, Label } from './ui';

type Result = components['schemas']['TransitionResultDto'];

const NEEDS_REASON = new Set(['RETURN', 'CANCEL', 'CUSTOMER_ACCEPT', 'CUSTOMER_REJECT']);
const NEEDS_CONFIRM = new Set(['EDIT', 'REVISE']);

/** Ações possíveis da proposta no estado atual (vêm do servidor: a tabela de transições é única). */
export function WorkflowBar({ proposalId, onChanged }: { proposalId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['transitions', proposalId], queryFn: () => apiGet<Result>(`/proposals/${proposalId}/transitions`) });
  const [pending, setPending] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const run = useMutation({
    mutationFn: (event: string) => apiPost<Result>(`/proposals/${proposalId}/transitions`, { event, reason: reason || undefined, confirm: confirm || undefined }),
    onSuccess: (r) => {
      qc.setQueryData(['transitions', proposalId], r);
      setPending(null); setReason(''); setConfirm(false); setError(null); setOk(true);
      void qc.invalidateQueries({ queryKey: ['proposal', proposalId] });
      void qc.invalidateQueries({ queryKey: ['timeline', proposalId] });
      onChanged();
    },
    onError: (e: Error) => {
      setOk(false);
      const code = e instanceof ApiError ? (e.body as { code?: string } | undefined)?.code : undefined;
      if (code === 'NEEDS_CONFIRMATION') setConfirm(false);
      setError(e.message);
    },
  });

  function start(event: string) {
    setOk(false); setError(null);
    if (NEEDS_REASON.has(event) || NEEDS_CONFIRM.has(event)) setPending(event);
    else run.mutate(event);
  }

  if (!state.data) return null;
  const events = state.data.availableEvents;
  const needsReason = !!pending && NEEDS_REASON.has(pending);
  const needsConfirm = !!pending && NEEDS_CONFIRM.has(pending);

  return (
    <div className="space-y-3" aria-label="workflow">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--muted)] px-3 py-1 text-sm font-medium" data-testid="status">{t(`status.${state.data.status}`)}</span>
        {events.map((e) => (
          <Button key={e} variant={e === 'CANCEL' ? 'ghost' : 'outline'} disabled={run.isPending} onClick={() => start(e)}>{t(`wf.event.${e}`)}</Button>
        ))}
      </div>
      {pending && (
        <div className="max-w-xl space-y-3 rounded-md border border-[var(--border)] p-3">
          <p className="font-medium">{t(`wf.event.${pending}`)}</p>
          {needsReason && (<div><Label htmlFor="wf-reason">{t('wf.reason')}</Label><Input id="wf-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>)}
          {needsConfirm && (<label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />{t('wf.confirm')}</label>)}
          <div className="flex gap-2">
            <Button disabled={run.isPending || (needsReason && !reason.trim()) || (needsConfirm && !confirm)} onClick={() => run.mutate(pending)}>{t('wf.run')}</Button>
            <Button variant="outline" onClick={() => setPending(null)}>{t('wf.abort')}</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {ok && !error && <p role="status" className="text-sm text-green-700">{t('wf.done')}</p>}
    </div>
  );
}
