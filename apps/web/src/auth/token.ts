import { env } from '../lib/env';
import { useAuth } from './store';

/** Token atual para a API: sessão de desenvolvimento ou token MSAL renovado em silêncio. */
export async function getAccessToken(): Promise<string | null> {
  if (env.authMode === 'entra') {
    const { acquireEntraToken } = await import('./msal');
    const r = await acquireEntraToken();
    return r?.token ?? null;
  }
  return useAuth.getState().session?.token ?? null;
}
