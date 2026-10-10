import type { AppAbility } from '../authz/ability.js';

/** Remove margens das respostas para quem não pode ver custos (a margem permitiria deduzir o custo). */
export function maskCost<T>(value: T, ability: AppAbility): T {
  if (ability.can('read', 'Cost')) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'marginPercent' ? null : walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
