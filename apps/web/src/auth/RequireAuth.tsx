import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { hasRole, useAuth } from './store';

export function RequireAuth({ children, roles }: { children: ReactNode; roles?: string[] }) {
  const { session } = useAuth();
  const location = useLocation();

  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.user.mustChangePassword && location.pathname !== '/mudar-palavra-passe') return <Navigate to="/mudar-palavra-passe" replace />;
  if (roles && !hasRole(session, ...roles)) return <Navigate to="/acesso-negado" replace />;
  return <>{children}</>;
}
