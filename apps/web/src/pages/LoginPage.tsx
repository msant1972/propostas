import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import type { components } from '@cpq/api-client';
import { useAuth } from '../auth/store';
import { Button, Input, Label } from '../components/ui';
import { ApiError, apiPost } from '../lib/api';

type LoginResult = components['schemas']['LoginResultDto'];

export function LoginPage() {
  const { t } = useTranslation();
  const { session, setSession } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/propostas';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (session && !session.user.mustChangePassword) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await apiPost<LoginResult>('/auth/login', { email, password });
      setSession(r);
      navigate(r.user.mustChangePassword ? '/mudar-palavra-passe' : from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 423 ? t('login.locked') : err instanceof ApiError && err.status === 401 ? t('login.invalid') : t('login.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, var(--primary-soft), transparent 70%), var(--background)' }}>
      <div className="enter glass w-full max-w-[380px] rounded-[22px] p-8 shadow-[var(--shadow-lg)]">
        <div className="mb-7 text-center">
          <div aria-hidden="true" className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[16px] bg-[var(--primary)] text-2xl font-bold text-white shadow-[var(--shadow-md)]">C</div>
          <p className="text-[13px] font-medium text-[var(--secondary)]">{t('app.title')}</p>
          <h1 className="mt-1 text-[26px] font-bold">{t('login.title')}</h1>
        </div>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div><Label htmlFor="email">{t('login.email')}</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label htmlFor="password">{t('login.password')}</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p role="alert" className="rounded-[10px] bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full !min-h-11">{t('login.submit')}</Button>
      </form>
      </div>
    </main>
  );
}
