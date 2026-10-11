import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
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
    <NavLink to={to} className="nav-link">{label}</NavLink>
  );

  return (
    <div className="min-h-screen">
      <header className="navbar">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 sm:px-6 md:flex-nowrap">
          <span className="mr-2 text-[15px] font-semibold tracking-tight">{t('app.title')}</span>
          <nav className="order-last -mx-1 flex w-full items-center gap-0.5 overflow-x-auto pb-1 md:order-none md:mx-0 md:w-auto md:flex-1 md:pb-0" style={{ scrollbarWidth: 'none' }}>
            {link('/propostas', t('nav.proposals'))}
            {link('/aprovacoes', t('nav.approvals'))}
            {link('/clientes', t('nav.clients'))}
            {link('/conteudos', t('nav.content'))}
            {link('/catalogo', t('nav.catalog'))}
            {admin && link('/politicas', t('nav.policies'))}
            {admin && link('/utilizadores', t('nav.users'))}
            {admin && link('/integracoes', t('nav.integrations'))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Link to="/mudar-palavra-passe" className="hidden max-w-[10rem] truncate lg:block rounded-full px-2 py-1 text-[13px] text-[var(--secondary)] hover:bg-[var(--fill)] hover:text-[var(--foreground)]" title={t('nav.password')}>{session?.user.displayName}</Link>
            <Button variant="outline" onClick={logout}>{t('nav.logout')}</Button>
          </div>
        </div>
      </header>
      <div className="enter mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <Outlet />
      </div>
    </div>
  );
}
