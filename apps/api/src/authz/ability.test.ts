import { describe, expect, it } from 'vitest';
import { defineAbilityFor, type Actor } from './ability.js';

const actor = (over: Partial<Actor>): Actor => ({
  userId: 'u1',
  teamId: 't1',
  region: 'PT',
  roles: [],
  ...over,
});

describe('defineAbilityFor', () => {
  it('qualquer utilizador lê o catálogo mas não o altera', () => {
    const a = defineAbilityFor(actor({ roles: ['Comercial'] }));
    expect(a.can('read', 'Product')).toBe(true);
    expect(a.can('update', 'Product')).toBe(false);
  });

  it('comercial só acede às suas propostas', () => {
    const a = defineAbilityFor(actor({ roles: ['Comercial'] }));
    expect(a.can('update', { __caslSubjectType__: 'Proposal', ownerUserId: 'u1' } as never)).toBe(true);
    expect(a.can('update', { __caslSubjectType__: 'Proposal', ownerUserId: 'u2' } as never)).toBe(false);
  });

  it('gestor vê as propostas da equipa', () => {
    const a = defineAbilityFor(actor({ roles: ['Gestor_Comercial'] }));
    expect(a.can('read', { __caslSubjectType__: 'Proposal', ownerTeamId: 't1' } as never)).toBe(true);
    expect(a.can('read', { __caslSubjectType__: 'Proposal', ownerTeamId: 't2' } as never)).toBe(false);
  });

  it('aprovador só vê propostas que lhe estão atribuídas', () => {
    const a = defineAbilityFor(actor({ roles: ['Aprovador_Financeiro'] }));
    expect(a.can('read', { __caslSubjectType__: 'Proposal', approverUserIds: ['u1', 'u9'] } as never)).toBe(true);
    expect(a.can('read', { __caslSubjectType__: 'Proposal', approverUserIds: ['u9'] } as never)).toBe(false);
  });

  it('administrador pode tudo, exceto alterar a auditoria', () => {
    const a = defineAbilityFor(actor({ roles: ['Administrador'] }));
    expect(a.can('delete', 'Product')).toBe(true);
    expect(a.can('delete', 'AuditLog')).toBe(false);
  });

  it('sem papéis só se lê catálogo e clientes', () => {
    const a = defineAbilityFor(actor({ roles: [] }));
    expect(a.can('create', 'Proposal')).toBe(false);
    expect(a.can('read', 'Client')).toBe(true);
  });
});

import { visibleProposalsWhere } from './ability.js';

describe('visibleProposalsWhere', () => {
  const a = (roles: Actor['roles']): Actor => ({ userId: 'u1', teamId: 't1', region: 'PT', roles });

  it('administrador vê tudo', () => expect(visibleProposalsWhere(a(['Administrador']))).toEqual({}));
  it('comercial vê as suas', () => expect(visibleProposalsWhere(a(['Comercial']))).toEqual({ OR: [{ ownerUserId: 'u1' }] }));
  it('gestor vê equipa e região, e soma-se ao papel de comercial', () => {
    expect(visibleProposalsWhere(a(['Comercial', 'Gestor_Comercial']))).toEqual({
      OR: [{ ownerUserId: 'u1' }, { ownerTeamId: 't1' }, { region: 'PT' }],
    });
  });
  it('sem papéis relevantes não vê nada', () => expect(visibleProposalsWhere(a(['Juridico']))).toEqual({ id: { in: [] } }));
});
