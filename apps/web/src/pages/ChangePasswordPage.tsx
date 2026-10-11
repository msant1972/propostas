import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { components } from '@cpq/api-client';
import { useAuth } from '../auth/store';
import { Button, Input, Label } from '../components/ui';
import { apiPost } from '../lib/api';

type LoginResult = components['schemas']['LoginResultDto'];

export function ChangePasswordPage() {
  const { t } = useTranslation();
  const { session, setSession } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const forced = !!session?.user.mustChangePassword;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (next !== again) return setError(t('password.mismatch'));
    try {
      setSession(await apiPost<LoginResult>('/auth/change-password', { currentPassword: current, newPassword: next }));
      setOk(true);
      setCurrent(''); setNext(''); setAgain('');
      if (forced) navigate('/propostas', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="mx-auto mt-16 max-w-sm px-4">
      <h1 className="mb-2 text-2xl font-semibold">{t('password.title')}</h1>
      {forced && <p className="mb-4 text-sm opacity-70">{t('password.forced')}</p>}
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div><Label htmlFor="cur">{t('password.current')}</Label><Input id="cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div><Label htmlFor="new">{t('password.new')}</Label><Input id="new" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div><Label htmlFor="again">{t('password.again')}</Label><Input id="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} /></div>
        <p className="text-xs opacity-70">{t('password.rules')}</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {ok && <p role="status" className="text-sm text-green-700">{t('password.changed')}</p>}
        <Button type="submit">{t('password.submit')}</Button>
      </form>
    </main>
  );
}
