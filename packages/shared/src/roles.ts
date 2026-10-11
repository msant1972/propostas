export const ROLES = [
  'Comercial',
  'Gestor_Comercial',
  'Aprovador_Financeiro',
  'Juridico',
  'Administrador',
] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Utilizadores de demonstração, criados pelo seed no ambiente de testes: um por papel.
 * A palavra-passe é conhecida e serve só para desenvolvimento e testes; em produção os utilizadores
 * são criados pelo administrador, com palavra-passe temporária.
 */
export const DEMO_PASSWORD = 'Demo-Pass-2026!';

export const DEMO_USERS: ReadonlyArray<{ role: Role; email: string; name: string }> = [
  { role: 'Comercial', email: 'comercial@exemplo.pt', name: 'Carla Comercial' },
  { role: 'Gestor_Comercial', email: 'gestor@exemplo.pt', name: 'Gonçalo Gestor' },
  { role: 'Aprovador_Financeiro', email: 'financeiro@exemplo.pt', name: 'Filipa Financeira' },
  { role: 'Juridico', email: 'juridico@exemplo.pt', name: 'Joana Jurídica' },
  { role: 'Administrador', email: 'admin@exemplo.pt', name: 'Artur Administrador' },
];

export const demoEmail = (role: Role): string => DEMO_USERS.find((u) => u.role === role)!.email;
