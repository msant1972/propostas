import { useTranslation } from 'react-i18next';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/store';
import { env } from '../lib/env';
import { Button } from './ui';

export function Layout() {
  const { t } = useTranslation();
  const { session, setSession } = useAuth();
  const navigate = useNavigate();

  async function logout() {
    setSession(null);
    if (env.authMode === 'entra') {
      const { entraLogout } = await import('../auth/msal');
      await entraLogout();
    } else navigate('/login');
  }

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
        <nav className="flex items-center gap-6">
          <span className="font-semibold">{t('app.title')}</span>
          <Link to="/catalogo" className="text-sm hover:underline">
            {t('nav.catalog')}
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span>{session?.displayName}</span>
          <Button variant="outline" onClick={() => void logout()}>
            {t('nav.logout')}
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </div>
    </div>
  );
}
