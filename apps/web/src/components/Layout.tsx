import { useTranslation } from 'react-i18next';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { hasRole, useAuth } from '../auth/store';
import { Button } from './ui';

export function Layout() {
  const { t } = useTranslation();
  const { session, setSession } = useAuth();
  const navigate = useNavigate();
  const admin = hasRole(session, 'Administrador');

  function logout() {
    setSession(null);
    navigate('/login');
  }

  const link = (to: string, label: string) => (
    <Link to={to} className="text-sm hover:underline">{label}</Link>
  );

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-[var(--border)] px-6 py-3">
        <nav className="flex flex-wrap items-center gap-6">
          <span className="font-semibold">{t('app.title')}</span>
          {link('/propostas', t('nav.proposals'))}
          {link('/aprovacoes', t('nav.approvals'))}
          {link('/clientes', t('nav.clients'))}
          {link('/conteudos', t('nav.content'))}
          {link('/catalogo', t('nav.catalog'))}
          {admin && link('/politicas', t('nav.policies'))}
          {admin && link('/utilizadores', t('nav.users'))}
          {admin && link('/integracoes', t('nav.integrations'))}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <Link to="/mudar-palavra-passe" className="hover:underline" title={t('nav.password')}>{session?.user.displayName}</Link>
          <Button variant="outline" onClick={logout}>{t('nav.logout')}</Button>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </div>
    </div>
  );
}
