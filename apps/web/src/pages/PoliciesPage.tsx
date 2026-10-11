import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { ROLES } from '@cpq/shared/roles';
import { Badge, Button, Input, Label, Select } from '../components/ui';
import { apiGet, apiPatch, apiPost } from '../lib/api';

type Policy = components['schemas']['PolicyDto'];
type Level = components['schemas']['LevelDto'];

const today = () => new Date().toISOString().slice(0, 10);
const blank = { name: '', scope: 'COMMERCIAL', mode: 'SEQUENTIAL', priority: 100, validFrom: today(), condition: '', levels: [{ level: 1, role: 'Gestor_Comercial', slaHours: 24 }] as Level[] };

export function PoliciesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['policies'], queryFn: () => apiGet<Policy[]>('/approval-policies') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['policies'] });

  const create = useMutation({
    mutationFn: () => {
      let condition: object | undefined;
      if (form.condition.trim()) {
        try { condition = JSON.parse(form.condition) as object; } catch { throw new Error('JSON inválido na condição'); }
      }
      return apiPost<Policy>('/approval-policies', { name: form.name, scope: form.scope, mode: form.mode, priority: Number(form.priority), validFrom: form.validFrom, condition, levels: form.levels });
    },
    onSuccess: () => { refresh(); setCreating(false); setForm(blank); setError(null); },
    onError: (e: Error) => setError(e.message),
  });
  const toggle = useMutation({ mutationFn: (p: Policy) => apiPatch<Policy>(`/approval-policies/${p.id}`, { isActive: !p.isActive }), onSuccess: refresh });

  const setLevel = (i: number, patch: Partial<Level>) => setForm({ ...form, levels: form.levels.map((l, n) => (n === i ? { ...l, ...patch } : l)) });
  function submit(e: FormEvent) { e.preventDefault(); setError(null); create.mutate(); }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="mb-6 text-[28px] font-bold leading-tight sm:text-[32px]">{t('policies.title')}</h1>
        <Button onClick={() => setCreating(true)}>{t('policies.new')}</Button>
      </div>

      {creating && (
        <form onSubmit={submit} className="mb-6 max-w-2xl space-y-4 card p-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="p-name">{t('policies.name')}</Label><Input id="p-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label htmlFor="p-scope">{t('policies.scope')}</Label>
              <Select id="p-scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}><option value="COMMERCIAL">{t('approvals.scope.COMMERCIAL')}</option><option value="LEGAL">{t('approvals.scope.LEGAL')}</option></Select></div>
            <div><Label htmlFor="p-mode">{t('policies.mode')}</Label>
              <Select id="p-mode" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="SEQUENTIAL">{t('policies.SEQUENTIAL')}</option><option value="PARALLEL">{t('policies.PARALLEL')}</option></Select></div>
            <div><Label htmlFor="p-prio">{t('policies.priority')}</Label><Input id="p-prio" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} /></div>
            <div><Label htmlFor="p-from">{t('policies.validFrom')}</Label><Input id="p-from" type="date" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></div>
          </div>
          <div>
            <Label htmlFor="p-cond">{t('policies.condition')}</Label>
            <textarea id="p-cond" rows={4} className="w-full rounded-md border border-[var(--border)] bg-transparent p-2 font-mono text-xs" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} />
            <p className="text-xs text-[var(--secondary)]">{t('policies.help')}</p>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">{t('policies.levels')}</p>
            {form.levels.map((l, i) => (
              <div key={i} className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <span>{t('policies.level')} {l.level}</span>
                <Select aria-label={t('policies.role')} className="w-48" value={l.role} onChange={(e) => setLevel(i, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</Select>
                <Input aria-label={t('policies.sla')} type="number" className="w-24" value={l.slaHours} onChange={(e) => setLevel(i, { slaHours: Number(e.target.value) })} /> h
                <Select aria-label={t('policies.escalate')} className="w-48" value={l.escalateToRole ?? ''} onChange={(e) => setLevel(i, { escalateToRole: e.target.value || undefined })}><option value="">{t('policies.escalate')}</option>{ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}</Select>
              </div>
            ))}
            <Button type="button" variant="outline" onClick={() => setForm({ ...form, levels: [...form.levels, { level: form.levels.length + 1, role: 'Aprovador_Financeiro', slaHours: 48 }] })}>{t('policies.addLevel')}</Button>
          </div>
          {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
          <div className="flex gap-2"><Button type="submit" disabled={create.isPending}>{t('common.create')}</Button><Button type="button" variant="outline" onClick={() => setCreating(false)}>{t('common.cancel')}</Button></div>
        </form>
      )}

      <ul className="group-list">
        {list.data?.map((p) => (
          <li key={p.id} className="text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{p.name}</span>
              <Badge tone="blue">{t(`approvals.scope.${p.scope}`)}</Badge>
              <span className="text-[var(--secondary)]">{t(`policies.${p.mode}`)} · {t('policies.priority')} {p.priority}</span>
              <Button className="ml-auto" variant="ghost" onClick={() => toggle.mutate(p)}>{p.isActive ? t('policies.active') : t('users.activate')}</Button>
            </div>
            <div className="mt-1 text-[var(--secondary)]">{p.levels.map((l) => `${l.level}. ${t(`roles.${l.role}`, { defaultValue: l.role })} (${l.slaHours} h)`).join(' → ')}</div>
            <pre className="mt-2 overflow-x-auto rounded-[10px] bg-[var(--fill)] p-2 text-xs">{p.condition ? JSON.stringify(p.condition) : '—'}</pre>
          </li>
        ))}
      </ul>
    </section>
  );
}
