import { useAuth } from './store';

/** Token da sessão atual (ou null). */
export async function getAccessToken(): Promise<string | null> {
  return useAuth.getState().session?.accessToken ?? null;
}
