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
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-6 text-2xl font-semibold">{t('login.title')}</h1>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div><Label htmlFor="email">{t('login.email')}</Label><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label htmlFor="password">{t('login.password')}</Label><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={busy}>{t('login.submit')}</Button>
      </form>
    </main>
  );
}
