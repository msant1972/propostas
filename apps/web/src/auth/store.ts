import { create } from 'zustand';

export interface Session {
  token: string;
  displayName: string;
  email: string;
  roles: string[];
}

const KEY = 'cpq.session';

function load(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
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
