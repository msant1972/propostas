import type { PrismaClient } from '@cpq/db';

export interface Person {
  id: string;
  name: string;
  email: string;
}

/** Utilizadores ativos cujo último papel conhecido (guardado no login) inclui `role`; restringe à equipa se for dada. */
export async function usersWithRole(prisma: PrismaClient, role: string, opts: { teamId?: string | null; excludeUserId?: string } = {}): Promise<Person[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string; display_name: string; email: string; team_id: string | null }>>`
    SELECT id, display_name, email, team_id FROM users
    WHERE is_active = TRUE AND roles_json IS NOT NULL AND JSON_CONTAINS(roles_json, JSON_QUOTE(${role}))`;
  return rows
    .filter((u) => u.id !== opts.excludeUserId && (!opts.teamId || !u.team_id || u.team_id === opts.teamId || role !== 'Gestor_Comercial'))
    .map((u) => ({ id: u.id, name: u.display_name, email: u.email }));
}

/** Quem tem delegação ativa de algum dos `fromUserIds`. */
export async function delegatesOf(prisma: PrismaClient, fromUserIds: string[], today = new Date()): Promise<Person[]> {
  if (fromUserIds.length === 0) return [];
  const d = new Date(today.toISOString().slice(0, 10));
  const rows = await prisma.approvalDelegation.findMany({ where: { fromUserId: { in: fromUserIds }, validFrom: { lte: d }, validTo: { gte: d } } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.toUserId) }, isActive: true } });
  return users.map((u) => ({ id: u.id, name: u.displayName, email: u.email }));
}

export function uniquePeople(...lists: Person[][]): Person[] {
  const m = new Map<string, Person>();
  for (const l of lists) for (const p of l) m.set(p.id, p);
  return [...m.values()];
}
