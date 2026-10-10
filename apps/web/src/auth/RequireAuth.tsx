import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { Role } from '@cpq/shared/roles';
import { env } from '../lib/env';
import { useAuth } from './store';

/** Em modo Entra, completa o redirecionamento do MSAL e preenche a sessão a partir de /me. */
function useEntraBootstrap(): boolean {
  const { session, setSession } = useAuth();
  const [ready, setReady] = useState(env.authMode !== 'entra' || !!session);

  useEffect(() => {
    if (env.authMode !== 'entra' || session) return;
    let cancelled = false;
    void (async () => {
      const { acquireEntraToken } = await import('./msal');
      const r = await acquireEntraToken();
      if (!cancelled && r) {
        const res = await fetch(`${env.apiBase}/api/v1/me`, { headers: { Authorization: `Bearer ${r.token}` } });
        if (res.ok) {
          const me = (await res.json()) as { displayName: string; email: string; roles: string[] };
          setSession({ token: r.token, displayName: me.displayName, email: me.email, roles: me.roles });
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, setSession]);

  return ready;
}

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { session } = useAuth();
  const location = useLocation();
  const ready = useEntraBootstrap();

  if (!ready) return null;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.some((r) => session.roles.includes(r))) return <Navigate to="/acesso-negado" replace />;
  return <>{children}</>;
}
