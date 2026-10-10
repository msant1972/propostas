/**
 * Máquina de estados da proposta (tabela de transições de Arquitetura.md). Código puro, sem I/O:
 * a API aplica-a e a UI usa-a para mostrar apenas as ações possíveis.
 */
export const PROPOSAL_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export type WorkflowEvent =
  | 'COMPILE' // DRAFT → IN_REVIEW: documento gerado
  | 'EDIT' // volta a editar
  | 'SUBMIT' // IN_REVIEW → PENDING_APPROVAL (ou APPROVED sem políticas)
  | 'APPROVE' // último nível aprovado
  | 'RETURN' // aprovador devolve/rejeita, ou autor retira
  | 'SEND'
  | 'CUSTOMER_ACCEPT'
  | 'CUSTOMER_REJECT'
  | 'EXPIRE'
  | 'REVISE' // rever após envio
  | 'REOPEN' // reabrir uma proposta expirada
  | 'CANCEL';

export interface Transition {
  from: ProposalStatus;
  event: WorkflowEvent;
  to: ProposalStatus;
  /** Motivo obrigatório (comentário/justificação). */
  requiresReason?: boolean;
  /** Pede confirmação explícita ao utilizador (invalida aprovações ou documentos). */
  requiresConfirmation?: boolean;
  /** A transição cria uma nova versão de cotação quando a atual está bloqueada. */
  newQuoteVersion?: boolean;
}

const CANCELLABLE: ProposalStatus[] = ['DRAFT', 'IN_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'SENT'];

export const TRANSITIONS: readonly Transition[] = [
  { from: 'DRAFT', event: 'COMPILE', to: 'IN_REVIEW' },
  { from: 'IN_REVIEW', event: 'EDIT', to: 'DRAFT', newQuoteVersion: true },
  { from: 'IN_REVIEW', event: 'SUBMIT', to: 'PENDING_APPROVAL' },
  { from: 'PENDING_APPROVAL', event: 'APPROVE', to: 'APPROVED' },
  { from: 'PENDING_APPROVAL', event: 'RETURN', to: 'DRAFT', requiresReason: true, newQuoteVersion: true },
  { from: 'APPROVED', event: 'SEND', to: 'SENT' },
  { from: 'APPROVED', event: 'EDIT', to: 'DRAFT', requiresConfirmation: true, newQuoteVersion: true },
  { from: 'SENT', event: 'CUSTOMER_ACCEPT', to: 'ACCEPTED' },
  { from: 'SENT', event: 'CUSTOMER_REJECT', to: 'REJECTED' },
  { from: 'SENT', event: 'EXPIRE', to: 'EXPIRED' },
  { from: 'SENT', event: 'REVISE', to: 'DRAFT', requiresConfirmation: true, newQuoteVersion: true },
  { from: 'EXPIRED', event: 'REOPEN', to: 'DRAFT', newQuoteVersion: true },
  ...CANCELLABLE.map((from): Transition => ({ from, event: 'CANCEL', to: 'CANCELLED', requiresReason: true })),
];

export const TERMINAL_STATUSES: readonly ProposalStatus[] = ['ACCEPTED', 'REJECTED', 'CANCELLED'];

export function findTransition(from: ProposalStatus, event: WorkflowEvent): Transition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.event === event);
}

/** Eventos que o utilizador pode desencadear a partir de um estado. */
export function availableEvents(from: ProposalStatus): WorkflowEvent[] {
  return TRANSITIONS.filter((t) => t.from === from).map((t) => t.event);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: ProposalStatus,
    public readonly event: WorkflowEvent,
  ) {
    super(`Transição inválida: ${event} a partir de ${from}`);
  }
}

export function transition(from: ProposalStatus, event: WorkflowEvent): Transition {
  const t = findTransition(from, event);
  if (!t) throw new InvalidTransitionError(from, event);
  return t;
}
