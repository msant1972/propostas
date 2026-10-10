import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { Role } from '@cpq/shared';

export type Action = 'manage' | 'create' | 'read' | 'update' | 'delete';
export type Subject =
  | 'Product'
  | 'Client'
  | 'Proposal'
  | 'Quote'
  | 'PriceList'
  | 'TaxRate'
  | 'FxRate'
  | 'Rule'
  | 'Cost'
  | 'AuditLog'
  | 'User'
  | 'all';
export type AppAbility = MongoAbility<[Action, Subject | Record<string, unknown>]>;

/** Utilizador autenticado já ligado à linha de `users`. */
export interface Actor {
  userId: string;
  teamId: string | null;
  region: string | null;
  roles: Role[];
}

/**
 * Regras por papel e por registo (dono, equipa, região). Os papéis somam permissões.
 * As condições usam os nomes das colunas das tabelas (camelCase do Prisma).
 */
export function defineAbilityFor(actor: Actor): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const has = (r: Role) => actor.roles.includes(r);

  if (has('Administrador')) {
    can('manage', 'all');
    cannot(['update', 'delete'], 'AuditLog'); // append-only, mesmo para administradores
    return build();
  }

  // Catálogo e clientes: leitura para qualquer utilizador autenticado.
  can('read', 'Product');
  can('read', 'Client');
  can('read', 'TaxRate');
  can('read', 'FxRate');

  if (has('Comercial')) {
    can('create', 'Proposal');
    can('read', 'PriceList');
    can(['read', 'update'], 'Proposal', { ownerUserId: actor.userId });
    can('create', 'Client');
  }

  // Custos e margens: informação restrita (a aprovação por margem exige que alguém a veja).
  if (has('Gestor_Comercial') || has('Aprovador_Financeiro')) can('read', 'Cost');

  if (has('Gestor_Comercial')) {
    can(['read', 'update'], 'Proposal', { ownerUserId: actor.userId }); // um gestor também cota
  }
  if (has('Gestor_Comercial') && actor.teamId) {
    can(['read', 'update'], 'Proposal', { ownerTeamId: actor.teamId });
    if (actor.region) can('read', 'Proposal', { region: actor.region });
    can(['create', 'update'], 'Client');
    can('read', 'User', { teamId: actor.teamId });
  }

  if (has('Aprovador_Financeiro')) {
    can('read', 'Proposal', { approverUserIds: { $in: [actor.userId] } });
  }

  if (has('Juridico')) {
    can('read', 'Proposal', { legalApproverUserIds: { $in: [actor.userId] } });
  }

  return build();
}

/**
 * Filtro Prisma equivalente às regras de visibilidade de propostas de `defineAbilityFor`,
 * para listagens (a consulta já devolve só o que o utilizador pode ver).
 */
export function visibleProposalsWhere(actor: Actor): Record<string, unknown> {
  if (actor.roles.includes('Administrador')) return {};
  const or: Record<string, unknown>[] = [];
  if (actor.roles.includes('Comercial') || actor.roles.includes('Gestor_Comercial')) or.push({ ownerUserId: actor.userId });
  if (actor.roles.includes('Gestor_Comercial') && actor.teamId) {
    or.push({ ownerTeamId: actor.teamId });
    if (actor.region) or.push({ region: actor.region });
  }
  return or.length ? { OR: or } : { id: { in: [] } };
}
