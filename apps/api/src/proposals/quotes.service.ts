import { retryOnConflict } from '../common/retry.js';
import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  calculateQuote, ConfigurationError, evaluateRules, fxRate, selectPriceList, snapshotHash,
  type Catalog, type ClientContext, type QuoteInput, type QuoteResult,
} from '@cpq/rules-engine';
import { Prisma as Sql } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CatalogLoader } from '../cpq/catalog-loader.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type {
  QuotePreviewResultDto, QuoteVersionDto, QuoteVersionSummaryDto, SaveQuoteDto, VerifyQuoteDto,
} from './proposals.dto.js';

type ProposalRow = { id: string; clientId: string; currency: string; region: string | null; status?: string };
type ClientRow = { countryCode: string; tier: string | null; vatNumber: string | null; vatValid: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const num = (d: { toFixed(n: number): string }, n = 2) => d.toFixed(n);

@Injectable()
export class QuotesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(ENV) private readonly env: Env,
    private readonly loader: CatalogLoader,
    private readonly outbox: OutboxService,
  ) {}

  // -- cálculo ---------------------------------------------------------------------------------

  private clientContext(c: ClientRow, region: string | null): ClientContext {
    return { countryCode: c.countryCode, tier: c.tier, region, isBusiness: !!c.vatNumber, vatValid: c.vatValid };
  }

  private buildInput(p: ProposalRow, c: ClientRow, dto: SaveQuoteDto): QuoteInput {
    return {
      date: today(),
      currency: p.currency,
      channel: dto.channel ?? null,
      issuerCountry: this.env.ISSUER_COUNTRY,
      client: this.clientContext(c, p.region),
      globalDiscountPercent: dto.globalDiscountPercent ?? '0',
      lines: dto.lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        termMonths: l.termMonths,
        discountPercent: l.discountPercent ?? '0',
        attributes: l.attributes,
      })),
    };
  }

  private async compute(p: ProposalRow, dto: SaveQuoteDto): Promise<{ input: QuoteInput; result: QuoteResult; catalog: Catalog }> {
    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: p.clientId } });
    const catalog = await this.loader.load();
    const input = this.buildInput(p, client, dto);
    try {
      return { input, result: calculateQuote(input, catalog), catalog };
    } catch (e) {
      if (e instanceof ConfigurationError) throw new UnprocessableEntityException({ message: e.message, code: e.code });
      throw e;
    }
  }

  async preview(p: ProposalRow, dto: SaveQuoteDto): Promise<QuotePreviewResultDto> {
    const { result, catalog } = await this.compute(p, dto);
    const names = new Map(catalog.products.map((x) => [x.id, x.name]));
    return {
      valid: result.valid,
      priceListId: result.priceListId,
      totals: this.totalsOf(result),
      lines: result.lines.map((l) => ({
        ...l, productName: names.get(l.productId) ?? '', termMonths: dto.lines[l.lineNumber - 1]?.termMonths ?? null,
        attributes: dto.lines[l.lineNumber - 1]?.attributes ?? null,
      })),
      violations: result.violations,
    };
  }

  private totalsOf(r: QuoteResult) {
    const t = r.totals;
    return { subtotal: t.subtotal, discountAmount: t.discountAmount, totalTax: t.totalTax, grandTotal: t.grandTotal, mrr: t.mrr, tcv: t.tcv, marginPercent: t.marginPercent };
  }

  private fxToEur(currency: string, catalog: Catalog): string {
    try {
      return fxRate(catalog.fxRates, currency, 'EUR', today());
    } catch (e) {
      if (e instanceof ConfigurationError) throw new UnprocessableEntityException({ message: e.message, code: e.code });
      throw e;
    }
  }

  // -- versões ---------------------------------------------------------------------------------

  /** Cria a versão 1 (rascunho vazio) de uma proposta nova, na mesma transação da proposta. */
  async createInitialVersion(tx: Pick<Prisma, 'quoteVersion'>, p: ProposalRow, c: ClientRow, createdBy: string): Promise<void> {
    const catalog = await this.loader.load();
    let priceListId: string;
    try {
      priceListId = selectPriceList(catalog.priceLists, {
        date: today(), currency: p.currency, region: p.region, channel: null, clientTier: c.tier,
      }).id;
    } catch (e) {
      if (e instanceof ConfigurationError) throw new UnprocessableEntityException({ message: e.message, code: e.code });
      throw e;
    }
    await tx.quoteVersion.create({
      data: { id: uuidv7(), proposalId: p.id, versionNumber: 1, priceListId, currency: p.currency, createdBy },
    });
  }

  async list(proposalId: string): Promise<QuoteVersionSummaryDto[]> {
    const rows = await this.prisma.quoteVersion.findMany({ where: { proposalId }, orderBy: { versionNumber: 'desc' } });
    return rows.map((v) => ({
      id: v.id, versionNumber: v.versionNumber, status: v.status, isCurrent: v.isCurrent,
      grandTotal: num(v.grandTotal), totalTcv: num(v.totalTcv),
      marginPercent: v.marginPercent ? num(v.marginPercent) : null,
      snapshotHash: v.snapshotHash, createdAt: v.createdAt.toISOString(),
    }));
  }

  async current(proposalId: string): Promise<QuoteVersionDto> {
    const v = await this.prisma.quoteVersion.findFirst({ where: { proposalId, isCurrent: true } });
    if (!v) throw new NotFoundException('Proposta sem versão de cotação');
    return this.get(proposalId, v.id);
  }

  async get(proposalId: string, versionId: string): Promise<QuoteVersionDto> {
    const v = await this.prisma.quoteVersion.findFirst({ where: { id: versionId, proposalId }, include: { items: { orderBy: { lineNumber: 'asc' } } } });
    if (!v) throw new NotFoundException('Versão de cotação não encontrada');

    let violations: QuoteVersionDto['violations'];
    if (v.status === 'DRAFT') {
      const p = await this.prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
      const client = await this.prisma.client.findUniqueOrThrow({ where: { id: p.clientId } });
      const catalog = await this.loader.load();
      violations = evaluateRules(this.buildInput(p, client, this.dtoFromItems(v)), catalog).violations;
    } else {
      violations = ((v.snapshotJson as { evaluation?: { violations?: QuoteVersionDto['violations'] } } | null)?.evaluation?.violations) ?? [];
    }

    return {
      id: v.id, proposalId: v.proposalId, versionNumber: v.versionNumber, status: v.status, isCurrent: v.isCurrent,
      currency: v.currency, priceListId: v.priceListId, globalDiscountPercent: num(v.discountPercent),
      totals: {
        subtotal: num(v.subtotal), discountAmount: num(v.discountAmount), totalTax: num(v.totalTax),
        grandTotal: num(v.grandTotal), mrr: num(v.totalMrr), tcv: num(v.totalTcv),
        marginPercent: v.marginPercent ? num(v.marginPercent) : null,
      },
      lines: v.items.map((i) => ({
        lineNumber: i.lineNumber, productId: i.productId, productName: i.productNameSnapshot,
        quantity: num(i.quantity, 3), termMonths: i.termMonths, listUnitPrice: num(i.listUnitPrice, 4),
        discountPercent: num(i.discountPercent), netUnitPrice: num(i.netUnitPrice, 4),
        globalDiscountAmount: num(i.globalDiscountAmount), taxRatePercent: num(i.taxRatePercent),
        taxRegime: i.taxRegime, taxAmount: num(i.taxAmount), lineTotal: num(i.lineTotal),
        attributes: (i.attributesJson as Record<string, unknown> | null) ?? null,
      })),
      snapshotHash: v.snapshotHash, lockedAt: v.lockedAt?.toISOString() ?? null, violations,
    };
  }

  private dtoFromItems(v: { discountPercent: { toFixed(n: number): string }; items: Array<{ productId: string; quantity: { toString(): string }; termMonths: number | null; discountPercent: { toFixed(n: number): string }; attributesJson: unknown }> }): SaveQuoteDto {
    return {
      globalDiscountPercent: num(v.discountPercent),
      lines: v.items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity.toString(),
        termMonths: i.termMonths ?? undefined,
        discountPercent: num(i.discountPercent),
        attributes: (i.attributesJson as Record<string, string | number | boolean> | null) ?? undefined,
      })),
    };
  }

  private async persist(
    tx: Pick<Prisma, 'quoteItem' | 'quoteVersion' | '$executeRaw'>, versionId: string, input: QuoteInput, result: QuoteResult, catalog: Catalog,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const names = new Map(catalog.products.map((p) => [p.id, p.name]));
    await tx.quoteItem.deleteMany({ where: { quoteVersionId: versionId } });
    // SQL direto: um único INSERT de várias linhas (o createMany do Prisma gastava ~50 % do CPU nesta rota).
    // Os valores decimais vão como texto: o MariaDB converte sem perder precisão.
    if (result.lines.length > 0) {
      const rows = result.lines.map((l) => {
        const src = input.lines[l.lineNumber - 1];
        return Sql.sql`(${uuidv7()}, ${versionId}, ${l.lineNumber}, ${l.productId}, ${names.get(l.productId) ?? ''},
          ${src?.attributes ? JSON.stringify(src.attributes) : null}, ${String(l.quantity)}, ${src?.termMonths ?? null},
          ${String(l.listUnitPrice)}, ${String(l.unitCost)}, ${String(l.costFxRate)}, ${String(l.discountPercent)},
          ${String(l.netUnitPrice)}, ${String(l.globalDiscountAmount)}, ${String(l.taxRatePercent)}, ${l.taxRegime},
          ${String(l.taxAmount)}, ${String(l.lineTotal)})`;
      });
      await tx.$executeRaw`INSERT INTO quote_items
        (id, quote_version_id, line_number, product_id, product_name_snapshot, attributes_json, quantity, term_months,
         list_unit_price, unit_cost, cost_fx_rate, discount_percent, net_unit_price, global_discount_amount,
         tax_rate_percent, tax_regime, tax_amount, line_total)
        VALUES ${Sql.join(rows)}`;
    }
    const t = result.totals;
    await tx.quoteVersion.update({
      where: { id: versionId },
      data: {
        priceListId: result.priceListId, currency: result.currency, fxRateToEur: this.fxToEur(result.currency, catalog),
        subtotal: t.subtotal, discountPercent: input.globalDiscountPercent ?? '0', discountAmount: t.discountAmount,
        totalTax: t.totalTax, grandTotal: t.grandTotal, totalMrr: t.mrr, totalTcv: t.tcv, marginPercent: t.marginPercent,
        ...extra,
      },
    });
  }

  private rejectInvalid(result: QuoteResult): void {
    if (!result.valid) {
      throw new UnprocessableEntityException({
        message: 'Cotação inválida',
        violations: result.violations.filter((v) => v.severity === 'error'),
      });
    }
  }

  /** A cotação só se altera/bloqueia nos estados que o workflow permite (a proposta não pode mudar a meio da revisão). */
  private assertProposalEditable(p: ProposalRow, allowed: string[]): void {
    if (p.status && !allowed.includes(p.status)) throw new ConflictException('A proposta não está num estado que permita alterar a cotação');
  }

  private async draft(proposalId: string, versionId: string) {
    const v = await this.prisma.quoteVersion.findFirst({ where: { id: versionId, proposalId } });
    if (!v) throw new NotFoundException('Versão de cotação não encontrada');
    if (v.status !== 'DRAFT') throw new ConflictException('A versão está bloqueada; crie uma nova versão');
    return v;
  }

  /** Grava um rascunho: o servidor reavalia sempre e rejeita configurações inválidas. */
  async saveDraft(p: ProposalRow, versionId: string, dto: SaveQuoteDto): Promise<QuoteVersionDto> {
    this.assertProposalEditable(p, ['DRAFT']);
    await this.draft(p.id, versionId);
    const { input, result, catalog } = await this.compute(p, dto);
    this.rejectInvalid(result);
    await retryOnConflict(() => this.prisma.$transaction((tx) => this.persist(tx, versionId, input, result, catalog)));
    return this.get(p.id, versionId);
  }

  /** Bloqueia a versão: recalcula, congela o snapshot e o hash. Depois disto, só uma nova versão pode mudar. */
  async lock(p: ProposalRow, versionId: string, actorUserId: string, allowedStatuses: string[] = ['DRAFT']): Promise<QuoteVersionDto> {
    this.assertProposalEditable(p, allowedStatuses);
    const v = await this.draft(p.id, versionId);
    const items = await this.prisma.quoteItem.findMany({ where: { quoteVersionId: versionId }, orderBy: { lineNumber: 'asc' } });
    if (items.length === 0) throw new UnprocessableEntityException('A cotação não tem linhas');

    const dto = this.dtoFromItems({ ...v, items });
    const { input, result, catalog } = await this.compute(p, dto);
    this.rejectInvalid(result);

    const productIds = new Set(input.lines.map((l) => l.productId));
    const snapshot = {
      schema: 1,
      proposalId: p.id,
      versionNumber: v.versionNumber,
      input,
      result: { priceListId: result.priceListId, currency: result.currency, lines: result.lines, totals: result.totals },
      evaluation: { violations: result.violations, defaults: result.defaults },
      rules: catalog.rules.filter((r) => productIds.has(r.sourceProductId)),
    };
    const hash = snapshotHash(snapshot);

    await retryOnConflict(() => this.prisma.$transaction(async (tx) => {
      await this.persist(tx, versionId, input, result, catalog, {
        status: 'LOCKED', lockedAt: new Date(), snapshotJson: snapshot as never, snapshotHash: hash,
      });
      await this.outbox.enqueue(tx, {
        aggregateId: p.id, eventType: 'quote.locked', payload: { versionId, snapshotHash: hash, actorUserId },
      });
    }));
    return this.get(p.id, versionId);
  }

  /** Nova versão a partir da corrente (bloqueada): a anterior passa a SUPERSEDED antes de a nova entrar. */
  async newVersion(p: ProposalRow, actorUserId: string): Promise<QuoteVersionDto> {
    const cur = await this.prisma.quoteVersion.findFirst({ where: { proposalId: p.id, isCurrent: true }, include: { items: true } });
    if (!cur) throw new NotFoundException('Proposta sem versão de cotação');
    if (cur.status !== 'LOCKED') throw new ConflictException('A versão atual ainda é um rascunho');

    const id = uuidv7();
    await this.prisma.$transaction(async (tx) => {
      await tx.quoteVersion.update({ where: { id: cur.id }, data: { isCurrent: false, status: 'SUPERSEDED' } });
      await tx.quoteVersion.create({
        data: {
          id, proposalId: p.id, versionNumber: cur.versionNumber + 1, priceListId: cur.priceListId, currency: cur.currency,
          fxRateToEur: cur.fxRateToEur, subtotal: cur.subtotal, discountPercent: cur.discountPercent, discountAmount: cur.discountAmount,
          totalTax: cur.totalTax, grandTotal: cur.grandTotal, totalMrr: cur.totalMrr, totalTcv: cur.totalTcv,
          marginPercent: cur.marginPercent, createdBy: actorUserId,
        },
      });
      await tx.quoteItem.createMany({
        data: cur.items.map(({ id: _old, quoteVersionId: _qv, attributesJson, ...rest }) => ({
          ...rest, id: uuidv7(), quoteVersionId: id, attributesJson: (attributesJson ?? undefined) as never,
        })),
      });
    });
    return this.get(p.id, id);
  }

  /** Recalcula o hash a partir do snapshot guardado: deteta qualquer alteração por fora da aplicação. */
  async verify(proposalId: string, versionId: string): Promise<VerifyQuoteDto> {
    const v = await this.prisma.quoteVersion.findFirst({ where: { id: versionId, proposalId } });
    if (!v) throw new NotFoundException('Versão de cotação não encontrada');
    if (!v.snapshotJson || !v.snapshotHash) return { valid: false, storedHash: v.snapshotHash, recomputedHash: null };
    const recomputed = snapshotHash(v.snapshotJson);
    return { valid: recomputed === v.snapshotHash, storedHash: v.snapshotHash, recomputedHash: recomputed };
  }
}
