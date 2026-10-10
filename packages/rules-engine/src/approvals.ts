import jsonLogic from 'json-logic-js';
import type { ISODate, QuoteInput, QuoteResult } from './types.js';

export type ApprovalScope = 'COMMERCIAL' | 'LEGAL';

export interface ApprovalLevel {
  level: number;
  /** Papel que pode decidir neste nível (ex.: Gestor_Comercial). */
  role: string;
  slaHours: number;
  escalateToRole?: string;
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  scope: ApprovalScope;
  /** JSONLogic sobre `ApprovalVars`; null = sempre. */
  condition: unknown | null;
  mode: 'SEQUENTIAL' | 'PARALLEL';
  levels: ApprovalLevel[];
  priority: number;
  isActive: boolean;
  validFrom: ISODate;
  validTo: ISODate | null;
}

/** Variáveis disponíveis nas condições das políticas. */
export interface ApprovalVars {
  max_line_discount_percent: number;
  global_discount_percent: number;
  /** Margem global da cotação; 100 quando não há custos conhecidos (a política de margem não dispara). */
  margin_percent: number;
  grand_total: number;
  tcv: number;
  has_modified_legal_section: boolean;
}

export function approvalVars(input: QuoteInput, result: QuoteResult, hasModifiedLegalSection: boolean): ApprovalVars {
  return {
    max_line_discount_percent: Math.max(0, ...input.lines.map((l) => Number(l.discountPercent ?? 0))),
    global_discount_percent: Number(input.globalDiscountPercent ?? 0),
    margin_percent: result.totals.marginPercent === null ? 100 : Number(result.totals.marginPercent),
    grand_total: Number(result.totals.grandTotal),
    tcv: Number(result.totals.tcv),
    has_modified_legal_section: hasModifiedLegalSection,
  };
}

/**
 * Políticas aplicáveis: ativas, em vigor e com a condição verdadeira. Por âmbito (comercial/jurídico) aplica-se
 * só a de menor `priority` (a primeira por ordem), para um pedido nunca ser duplicado.
 */
export function evaluatePolicies(policies: ApprovalPolicy[], vars: ApprovalVars, date: ISODate): ApprovalPolicy[] {
  const matching = policies
    .filter((p) => p.isActive && p.validFrom <= date && (p.validTo === null || p.validTo >= date))
    .filter((p) => p.condition === null || Boolean(jsonLogic.apply(p.condition as never, vars as never)))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const byScope = new Map<ApprovalScope, ApprovalPolicy>();
  for (const p of matching) if (!byScope.has(p.scope)) byScope.set(p.scope, p);
  return [...byScope.values()];
}

/** Valida níveis e condição ao gravar uma política: devolve o erro, ou null. */
export function validatePolicy(p: Pick<ApprovalPolicy, 'condition' | 'levels' | 'mode'>): string | null {
  if (p.levels.length === 0) return 'A política precisa de pelo menos um nível';
  const nums = p.levels.map((l) => l.level);
  if (new Set(nums).size !== nums.length) return 'Níveis repetidos';
  if (nums.some((n, i) => n !== i + 1)) return 'Os níveis têm de ser 1, 2, 3… sem saltos';
  if (p.levels.some((l) => !l.role || l.slaHours <= 0)) return 'Cada nível exige um papel e um SLA positivo';
  if (p.condition !== null) {
    try {
      jsonLogic.apply(p.condition as never, { max_line_discount_percent: 0, global_discount_percent: 0, margin_percent: 100, grand_total: 0, tcv: 0, has_modified_legal_section: false } as never);
    } catch (e) {
      return `Condição inválida: ${e instanceof Error ? e.message : 'erro'}`;
    }
  }
  return null;
}
