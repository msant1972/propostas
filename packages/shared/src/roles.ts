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

/** Identificadores fixos dos utilizadores de desenvolvimento (seed e login em modo dev). */
export const DEV_USER_OIDS: Record<Role, string> = {
  Comercial: '00000000-0000-4000-8000-000000000001',
  Gestor_Comercial: '00000000-0000-4000-8000-000000000002',
  Aprovador_Financeiro: '00000000-0000-4000-8000-000000000003',
  Juridico: '00000000-0000-4000-8000-000000000004',
  Administrador: '00000000-0000-4000-8000-000000000005',
};
