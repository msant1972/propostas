import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { DEV_USER_OIDS, ROLES, type Role } from '@cpq/shared/roles';
import { useAuth } from '../auth/store';
import { Button, Input, Label, Select } from '../components/ui';
import { env } from '../lib/env';

export function LoginPage() {
  const { t } = useTranslation();
  const { session, setSession } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? '/catalogo';

  const [role, setRole] = useState<Role>('Comercial');
  const [name, setName] = useState('Utilizador de teste');
  const [email, setEmail] = useState('teste@exemplo.pt');
  const [error, setError] = useState(false);

  if (session) return <Navigate to={from} replace />;

  async function devLogin(e: FormEvent) {
    e.preventDefault();
    setError(false);
    const res = await fetch(`${env.apiBase}/api/v1/dev/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oid: DEV_USER_OIDS[role], email, name, roles: [role] }),
    });
    if (!res.ok) return setError(true);
    const { accessToken } = (await res.json()) as { accessToken: string };
    setSession({ token: accessToken, displayName: name, email, roles: [role] });
    navigate(from, { replace: true });
  }

  async function entraLogin() {
    const { entraLogin } = await import('../auth/msal');
    await entraLogin();
  }

  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-6 text-2xl font-semibold">{t('login.title')}</h1>
      {env.authMode === 'entra' ? (
        <Button onClick={() => void entraLogin()}>{t('login.entra')}</Button>
      ) : (
        <form onSubmit={(e) => void devLogin(e)} className="space-y-4">
          <p className="text-sm opacity-70">{t('login.devNotice')}</p>
          <div>
            <Label htmlFor="role">{t('login.role')}</Label>
            <Select id="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="name">{t('login.name')}</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="email">{t('login.email')}</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          {error && <p role="alert" className="text-sm text-red-600">{t('login.error')}</p>}
          <Button type="submit">{t('login.submit')}</Button>
        </form>
      )}
    </main>
  );
}
