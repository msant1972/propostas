import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { components } from '@cpq/api-client';
import { ROLES } from '@cpq/shared/roles';
import { Button, Input, Label, Select } from '../components/ui';
import { apiGet, apiPatch, apiPost } from '../lib/api';

type User = components['schemas']['UserDto'];
type Page = components['schemas']['UserPageDto'];
type Team = components['schemas']['TeamDto'];
type WithPw = components['schemas']['UserWithPasswordDto'];

function RoleBoxes({ value, onChange, disabled }: { value: string[]; onChange: (r: string[]) => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-3">
      {ROLES.map((r) => (
        <label key={r} className="flex items-center gap-1 text-sm">
          <input type="checkbox" disabled={disabled} checked={value.includes(r)} onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} />
          {t(`roles.${r}`)}
        </label>
      ))}
    </div>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', displayName: '', roles: ['Comercial'] as string[], teamId: '' });
  const [error, setError] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [teamName, setTeamName] = useState('');

  const users = useQuery({ queryKey: ['users', q], queryFn: () => apiGet<Page>(`/users?pageSize=200${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => apiGet<Team[]>('/teams') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] });
  const fail = (e: Error) => setError(e.message);

  const create = useMutation({
    mutationFn: () => apiPost<WithPw>('/users', { email: form.email, displayName: form.displayName, roles: form.roles, teamId: form.teamId || undefined }),
    onSuccess: (r) => { setTemp({ email: r.user.email, password: r.temporaryPassword ?? '' }); setCreating(false); setForm({ email: '', displayName: '', roles: ['Comercial'], teamId: '' }); setError(null); refresh(); },
    onError: fail,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => apiPatch<User>(`/users/${id}`, body),
    onSuccess: () => { setError(null); refresh(); }, onError: fail,
  });
  const reset = useMutation({
    mutationFn: (u: User) => apiPost<WithPw>(`/users/${u.id}/reset-password`),
    onSuccess: (r) => { setTemp({ email: r.user.email, password: r.temporaryPassword ?? '' }); refresh(); }, onError: fail,
  });
  const unlock = useMutation({ mutationFn: (u: User) => apiPost<User>(`/users/${u.id}/unlock`), onSuccess: refresh, onError: fail });
  const addTeam = useMutation({
    mutationFn: () => apiPost<Team>('/teams', { name: teamName }),
    onSuccess: () => { setTeamName(''); void qc.invalidateQueries({ queryKey: ['teams'] }); }, onError: fail,
  });

  function submit(e: FormEvent) { e.preventDefault(); setError(null); create.mutate(); }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('users.title')}</h1>
        <Button onClick={() => setCreating(true)}>{t('users.new')}</Button>
      </div>

      {temp && (
        <div role="status" className="mb-4 rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
          <p>{t('users.temp')}</p>
          <p className="mt-1 font-mono text-base" data-testid="temp-password">{temp.password}</p>
          <p className="opacity-70">{temp.email}</p>
          <Button className="mt-2" variant="outline" onClick={() => setTemp(null)}>{t('common.cancel')}</Button>
        </div>
      )}

      {creating && (
        <form onSubmit={submit} className="mb-6 max-w-2xl space-y-4 rounded-md border border-[var(--border)] p-4">
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="u-email">{t('users.email')}</Label><Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label htmlFor="u-name">{t('users.name')}</Label><Input id="u-name" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></div>
            <div>
              <Label htmlFor="u-team">{t('users.team')}</Label>
              <Select id="u-team" value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
                <option value="">{t('users.noTeam')}</option>
                {teams.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
          </div>
          <div><Label htmlFor="u-roles">{t('users.roles')}</Label><RoleBoxes value={form.roles} onChange={(roles) => setForm({ ...form, roles })} /></div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2"><Button type="submit" disabled={create.isPending || form.roles.length === 0}>{t('common.create')}</Button><Button type="button" variant="outline" onClick={() => setCreating(false)}>{t('common.cancel')}</Button></div>
        </form>
      )}
      {!creating && error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}

      <Input aria-label={t('common.search')} placeholder={t('common.search')} className="mb-4 max-w-sm" value={q} onChange={(e) => setQ(e.target.value)} />
      {users.isPending && <p>{t('common.loading')}</p>}
      <div className="space-y-3">
        {users.data?.items.map((u) => (
          <div key={u.id} className="rounded-md border border-[var(--border)] p-3 text-sm" data-testid="user-row">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{u.displayName}</span><span className="opacity-70">{u.email}</span>
              {!u.isActive && <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs">{t('users.deactivate')}</span>}
              {u.locked && <span className="rounded bg-[var(--muted)] px-2 py-0.5 text-xs text-red-600">{t('users.locked')}</span>}
              <span className="ml-auto opacity-60">{t('users.lastLogin')}: {u.lastLoginAt ? u.lastLoginAt.slice(0, 16).replace('T', ' ') : t('users.never')}</span>
            </div>
            <div className="mt-2"><RoleBoxes value={u.roles} onChange={(roles) => patch.mutate({ id: u.id, body: { roles } })} /></div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select aria-label={t('users.team')} className="w-48" value={u.teamId ?? ''} onChange={(e) => patch.mutate({ id: u.id, body: { teamId: e.target.value || null } })}>
                <option value="">{t('users.noTeam')}</option>
                {teams.data?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
              <Button variant="outline" onClick={() => { if (confirm(t('users.confirmReset'))) reset.mutate(u); }}>{t('users.reset')}</Button>
              {u.locked && <Button variant="outline" onClick={() => unlock.mutate(u)}>{t('users.unlock')}</Button>}
              <Button variant="ghost" onClick={() => patch.mutate({ id: u.id, body: { isActive: !u.isActive } })}>{u.isActive ? t('users.deactivate') : t('users.activate')}</Button>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mb-2 mt-8 text-lg font-semibold">{t('users.teams')}</h2>
      <p className="mb-2 text-sm opacity-70">{teams.data?.map((x) => x.name).join(', ')}</p>
      <div className="flex max-w-sm gap-2">
        <Input aria-label={t('users.newTeam')} placeholder={t('users.newTeam')} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
        <Button variant="outline" disabled={!teamName.trim()} onClick={() => addTeam.mutate()}>{t('users.createTeam')}</Button>
      </div>
    </section>
  );
}
