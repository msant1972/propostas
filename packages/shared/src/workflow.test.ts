import { describe, expect, it } from 'vitest';
import {
  availableEvents, InvalidTransitionError, PROPOSAL_STATUSES, TERMINAL_STATUSES, TRANSITIONS, transition,
} from './workflow.js';

describe('máquina de estados da proposta', () => {
  it('o caminho feliz: rascunho → revisão → aprovação → aprovada → enviada → aceite', () => {
    let s = 'DRAFT' as (typeof PROPOSAL_STATUSES)[number];
    for (const e of ['COMPILE', 'SUBMIT', 'APPROVE', 'SEND', 'CUSTOMER_ACCEPT'] as const) s = transition(s, e).to;
    expect(s).toBe('ACCEPTED');
  });

  it('transições inválidas são recusadas', () => {
    expect(() => transition('DRAFT', 'SEND')).toThrow(InvalidTransitionError);
    expect(() => transition('ACCEPTED', 'EDIT')).toThrow(InvalidTransitionError);
    expect(() => transition('PENDING_APPROVAL', 'SEND')).toThrow(InvalidTransitionError);
  });

  it('estados terminais não têm saída', () => {
    for (const s of TERMINAL_STATUSES) expect(availableEvents(s)).toEqual([]);
  });

  it('todos os estados não terminais têm pelo menos uma saída e todos os destinos existem', () => {
    for (const s of PROPOSAL_STATUSES.filter((x) => !TERMINAL_STATUSES.includes(x))) {
      expect(availableEvents(s).length).toBeGreaterThan(0);
    }
    for (const t of TRANSITIONS) expect(PROPOSAL_STATUSES).toContain(t.to);
  });

  it('não há duas transições com o mesmo estado e evento', () => {
    const keys = TRANSITIONS.map((t) => `${t.from}/${t.event}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('devolver ou cancelar exige motivo; editar após aprovação exige confirmação e nova versão', () => {
    expect(transition('PENDING_APPROVAL', 'RETURN')).toMatchObject({ to: 'DRAFT', requiresReason: true, newQuoteVersion: true });
    expect(transition('SENT', 'CANCEL')).toMatchObject({ to: 'CANCELLED', requiresReason: true });
    expect(transition('APPROVED', 'EDIT')).toMatchObject({ requiresConfirmation: true, newQuoteVersion: true });
  });

  it('só se cancela antes de um desfecho', () => {
    expect(availableEvents('SENT')).toContain('CANCEL');
    expect(availableEvents('EXPIRED')).not.toContain('CANCEL');
  });
});
