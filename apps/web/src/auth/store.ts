import { create } from 'zustand';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  teamId: string | null;
  mustChangePassword: boolean;
}

export interface Session {
  accessToken: string;
  expiresAt: string;
  user: SessionUser;
}

const KEY = 'cpq.session';

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && new Date(s.expiresAt).getTime() > Date.now() ? s : null;
  } catch {
    return null;
  }
}

interface AuthState {
  session: Session | null;
  setSession: (s: Session | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  session: load(),
  setSession: (session) => {
    try {
      if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* armazenamento indisponível: a sessão vive só em memória */
    }
    set({ session });
  },
}));

export const hasRole = (s: Session | null, ...roles: string[]) => !!s && roles.some((r) => s.user.roles.includes(r));
