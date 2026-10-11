import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { assertSafeCondition } from '../common/condition-guard.js';
import { findPriceListOverlaps, validateCondition, type PriceList } from '@cpq/rules-engine';
import { uuidv7 } from '@cpq/shared';
import { CatalogLoader } from '../cpq/catalog-loader.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type {
  CreatePriceListDto, CreateProductDto, CreateRuleDto, CreateTaxRateDto, FxRateDto, PriceListDto, ReplaceAttributesDto,
  ReplaceBundleDto, ReplacePriceListItemsDto, RuleDto, TaxRateDto, UpdatePriceListDto, UpdateProductDto, UpdateRuleDto,
  UpsertFxRateDto,
} from './admin.dto.js';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s?: string | null) => (s ? new Date(s) : null);

@Injectable()
export class AdminService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly loader: CatalogLoader,
  ) {}

  // -- produtos --------------------------------------------------------------------------------

  async createProduct(dto: CreateProductDto) {
    if (dto.billingModel === 'RECURRING' && !dto.billingPeriod) {
      throw new UnprocessableEntityException('Produtos recorrentes exigem período de cobrança');
    }
    if (await this.prisma.product.findUnique({ where: { sku: dto.sku } })) throw new ConflictException('SKU já existe');
    const p = await this.prisma.product.create({ data: { id: uuidv7(), ...dto } as never });
    this.loader.invalidate();
    return p;
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const cur = await this.prisma.product.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Produto não encontrado');
    const billingModel = dto.billingModel ?? cur.billingModel;
    const billingPeriod = dto.billingPeriod ?? cur.billingPeriod;
    if (billingModel === 'RECURRING' && !billingPeriod) {
      throw new UnprocessableEntityException('Produtos recorrentes exigem período de cobrança');
    }
    if (dto.sku && dto.sku !== cur.sku && (await this.prisma.product.findUnique({ where: { sku: dto.sku } }))) {
      throw new ConflictException('SKU já existe');
    }
    const p = await this.prisma.product.update({ where: { id }, data: { ...(dto as Record<string, unknown>), rowVersion: { increment: 1 } } as never });
    this.loader.invalidate();
    return p;
  }

  async replaceAttributes(productId: string, dto: ReplaceAttributesDto): Promise<void> {
    await this.mustExistProduct(productId);
    const codes = dto.attributes.map((a) => a.code);
    if (new Set(codes).size !== codes.length) throw new UnprocessableEntityException('Códigos de atributo repetidos');
    await this.prisma.$transaction([
      this.prisma.productAttribute.deleteMany({ where: { productId } }),
      this.prisma.productAttribute.createMany({
        data: dto.attributes.map((a) => ({
          id: uuidv7(), productId, code: a.code, label: a.label, dataType: a.dataType as never,
          minValue: a.minValue, maxValue: a.maxValue, stepValue: a.stepValue,
          allowedValuesJson: a.allowedValues as never, isRequired: a.isRequired ?? false, defaultValue: a.defaultValue,
        })),
      }),
    ]);
    this.loader.invalidate();
  }

  async replaceBundle(bundleProductId: string, dto: ReplaceBundleDto): Promise<void> {
    await this.mustExistProduct(bundleProductId);
    const ids = dto.items.map((i) => i.componentProductId);
    if (ids.includes(bundleProductId)) throw new UnprocessableEntityException('Um bundle não pode conter-se a si próprio');
    if (new Set(ids).size !== ids.length) throw new UnprocessableEntityException('Componentes repetidos');
    const found = await this.prisma.product.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new UnprocessableEntityException('Componente inexistente');
    const nested = await this.prisma.productBundleItem.count({ where: { bundleProductId: { in: ids } } });
    if (nested > 0) throw new UnprocessableEntityException('Bundles dentro de bundles não são suportados');
    const asComponent = await this.prisma.productBundleItem.count({ where: { componentProductId: bundleProductId } });
    if (asComponent > 0 && ids.length > 0) throw new UnprocessableEntityException('Este produto já é componente de outro bundle');

    await this.prisma.$transaction([
      this.prisma.productBundleItem.deleteMany({ where: { bundleProductId } }),
      this.prisma.productBundleItem.createMany({
        data: dto.items.map((i, n) => ({
          id: uuidv7(), bundleProductId, componentProductId: i.componentProductId, isRequired: i.isRequired ?? true,
          defaultQuantity: i.defaultQuantity ?? '1', minQuantity: i.minQuantity, maxQuantity: i.maxQuantity, sortOrder: n,
        })),
      }),
    ]);
    this.loader.invalidate();
  }

  private async mustExistProduct(id: string): Promise<void> {
    if (!(await this.prisma.product.count({ where: { id } }))) throw new NotFoundException('Produto não encontrado');
  }

  // -- listas de preços ------------------------------------------------------------------------

  private priceListDto(l: { id: string; name: string; currency: string; region: string | null; channel: string | null; clientTier: string | null; validFrom: Date; validTo: Date | null }, itemCount: number): PriceListDto {
    return { id: l.id, name: l.name, currency: l.currency, region: l.region, channel: l.channel, clientTier: l.clientTier, validFrom: day(l.validFrom)!, validTo: day(l.validTo), itemCount };
  }

  async listPriceLists(): Promise<PriceListDto[]> {
    const lists = await this.prisma.priceList.findMany({ include: { _count: { select: { items: true } } }, orderBy: [{ currency: 'asc' }, { validFrom: 'desc' }] });
    return lists.map((l) => this.priceListDto(l, l._count.items));
  }

  /** Rejeita listas com os mesmos critérios e períodos sobrepostos: a escolha de preço tem de ser inequívoca. */
  private async assertNoOverlap(candidate: PriceList, ignoreId?: string): Promise<void> {
    const others = await this.prisma.priceList.findMany({ where: ignoreId ? { NOT: { id: ignoreId } } : {} });
    const asEngine = (l: (typeof others)[number]): PriceList => ({
      id: l.id, name: l.name, currency: l.currency, region: l.region, channel: l.channel, clientTier: l.clientTier,
      validFrom: day(l.validFrom)!, validTo: day(l.validTo), items: [],
    });
    const clash = findPriceListOverlaps([candidate, ...others.map(asEngine)]).find(([a]) => a.id === candidate.id);
    if (clash) throw new ConflictException(`Sobrepõe-se à lista "${clash[1].name}" com os mesmos critérios`);
  }

  async createPriceList(dto: CreatePriceListDto): Promise<PriceListDto> {
    const id = uuidv7();
    await this.assertNoOverlap({
      id, name: dto.name, currency: dto.currency, region: dto.region ?? null, channel: dto.channel ?? null,
      clientTier: dto.clientTier ?? null, validFrom: dto.validFrom, validTo: dto.validTo ?? null, items: [],
    });
    const l = await this.prisma.priceList.create({
      data: { id, name: dto.name, currency: dto.currency, region: dto.region, channel: dto.channel, clientTier: dto.clientTier, validFrom: new Date(dto.validFrom), validTo: date(dto.validTo) },
    });
    this.loader.invalidate();
    return this.priceListDto(l, 0);
  }

  async updatePriceList(id: string, dto: UpdatePriceListDto): Promise<PriceListDto> {
    const cur = await this.prisma.priceList.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!cur) throw new NotFoundException('Lista de preços não encontrada');
    const next = {
      name: dto.name ?? cur.name, currency: dto.currency ?? cur.currency, region: dto.region ?? cur.region,
      channel: dto.channel ?? cur.channel, clientTier: dto.clientTier ?? cur.clientTier,
      validFrom: dto.validFrom ?? day(cur.validFrom)!, validTo: dto.validTo ?? day(cur.validTo),
    };
    await this.assertNoOverlap({ id, ...next, items: [] }, id);
    const l = await this.prisma.priceList.update({
      where: { id },
      data: { ...next, validFrom: new Date(next.validFrom), validTo: date(next.validTo) },
    });
    this.loader.invalidate();
    return this.priceListDto(l, cur._count.items);
  }

  async replacePriceListItems(id: string, dto: ReplacePriceListItemsDto): Promise<void> {
    if (!(await this.prisma.priceList.count({ where: { id } }))) throw new NotFoundException('Lista de preços não encontrada');
    const keys = dto.items.map((i) => `${i.productId}|${Number(i.minQuantity ?? '0')}`);
    if (new Set(keys).size !== keys.length) throw new UnprocessableEntityException('Escalões repetidos para o mesmo produto');
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    if ((await this.prisma.product.count({ where: { id: { in: productIds } } })) !== productIds.length) {
      throw new UnprocessableEntityException('Produto inexistente na lista');
    }
    await this.prisma.$transaction([
      this.prisma.priceListItem.deleteMany({ where: { priceListId: id } }),
      this.prisma.priceListItem.createMany({
        data: dto.items.map((i) => ({ id: uuidv7(), priceListId: id, productId: i.productId, minQuantity: i.minQuantity ?? '0', unitPrice: i.unitPrice })),
      }),
    ]);
    this.loader.invalidate();
  }

  async priceListItems(id: string) {
    const items = await this.prisma.priceListItem.findMany({ where: { priceListId: id }, orderBy: [{ productId: 'asc' }, { minQuantity: 'asc' }] });
    return items.map((i) => ({ productId: i.productId, minQuantity: i.minQuantity.toString(), unitPrice: i.unitPrice.toFixed(4) }));
  }

  // -- impostos e câmbios ------------------------------------------------------------------------

  async listTaxRates(): Promise<TaxRateDto[]> {
    const rows = await this.prisma.taxRate.findMany({ orderBy: [{ countryCode: 'asc' }, { validFrom: 'desc' }] });
    return rows.map((t) => ({ id: t.id, countryCode: t.countryCode, taxCategory: t.taxCategory, regime: t.regime, ratePercent: t.ratePercent.toFixed(2), validFrom: day(t.validFrom)!, validTo: day(t.validTo) }));
  }

  async createTaxRate(dto: CreateTaxRateDto): Promise<TaxRateDto> {
    const dup = await this.prisma.taxRate.findFirst({ where: { countryCode: dto.countryCode, taxCategory: dto.taxCategory ?? 'STANDARD', regime: dto.regime as never, validFrom: new Date(dto.validFrom) } });
    if (dup) throw new ConflictException('Já existe uma taxa com estes critérios e início');
    const t = await this.prisma.taxRate.create({
      data: { id: uuidv7(), countryCode: dto.countryCode, taxCategory: dto.taxCategory ?? 'STANDARD', regime: dto.regime as never, ratePercent: dto.ratePercent, exemptionReason: dto.exemptionReason, validFrom: new Date(dto.validFrom), validTo: date(dto.validTo) },
    });
    this.loader.invalidate();
    return { id: t.id, countryCode: t.countryCode, taxCategory: t.taxCategory, regime: t.regime, ratePercent: t.ratePercent.toFixed(2), validFrom: day(t.validFrom)!, validTo: day(t.validTo) };
  }

  async listFxRates(): Promise<FxRateDto[]> {
    const rows = await this.prisma.fxRate.findMany({ orderBy: [{ rateDate: 'desc' }], take: 500 });
    return rows.map((f) => ({ id: f.id, baseCurrency: f.baseCurrency, quoteCurrency: f.quoteCurrency, rate: f.rate.toFixed(8), rateDate: day(f.rateDate)!, source: f.source }));
  }

  async upsertFxRate(dto: UpsertFxRateDto): Promise<FxRateDto> {
    if (dto.baseCurrency === dto.quoteCurrency) throw new UnprocessableEntityException('As moedas têm de ser diferentes');
    const rateDate = new Date(dto.rateDate);
    const f = await this.prisma.fxRate.upsert({
      where: { baseCurrency_quoteCurrency_rateDate: { baseCurrency: dto.baseCurrency, quoteCurrency: dto.quoteCurrency, rateDate } },
      update: { rate: dto.rate, source: dto.source },
      create: { id: uuidv7(), baseCurrency: dto.baseCurrency, quoteCurrency: dto.quoteCurrency, rate: dto.rate, rateDate, source: dto.source },
    });
    this.loader.invalidate();
    return { id: f.id, baseCurrency: f.baseCurrency, quoteCurrency: f.quoteCurrency, rate: f.rate.toFixed(8), rateDate: day(f.rateDate)!, source: f.source };
  }

  // -- regras ------------------------------------------------------------------------------------

  private ruleDto(r: Awaited<ReturnType<Prisma['cpqRule']['findFirstOrThrow']>>): RuleDto {
    return {
      id: r.id, sourceProductId: r.sourceProductId, targetProductId: r.targetProductId, ruleType: r.ruleType,
      condition: (r.conditionJson as Record<string, unknown> | null) ?? null, params: (r.paramsJson as Record<string, unknown> | null) ?? null,
      priority: r.priority, message: r.message, validFrom: day(r.validFrom)!, validTo: day(r.validTo), isActive: r.isActive,
    };
  }

  private async assertRuleValid(dto: Partial<CreateRuleDto>, type: string): Promise<void> {
    assertSafeCondition(dto.condition);
    const problem = validateCondition(dto.condition ?? null);
    if (problem) throw new UnprocessableEntityException(`Condição inválida: ${problem}`);
    if (['REQUIRES', 'EXCLUDES', 'RECOMMENDS'].includes(type) && !dto.targetProductId) {
      throw new UnprocessableEntityException('Este tipo de regra exige um produto alvo');
    }
    if (dto.targetProductId && dto.targetProductId === dto.sourceProductId) {
      throw new UnprocessableEntityException('Origem e alvo têm de ser produtos diferentes');
    }
    const ids = [dto.sourceProductId, dto.targetProductId].filter((x): x is string => !!x);
    if (ids.length && (await this.prisma.product.count({ where: { id: { in: ids } } })) !== new Set(ids).size) {
      throw new UnprocessableEntityException('Produto inexistente');
    }
  }

  async listRules(): Promise<RuleDto[]> {
    return (await this.prisma.cpqRule.findMany({ orderBy: [{ priority: 'asc' }, { id: 'asc' }] })).map((r) => this.ruleDto(r));
  }

  async createRule(dto: CreateRuleDto): Promise<RuleDto> {
    await this.assertRuleValid(dto, dto.ruleType);
    const r = await this.prisma.cpqRule.create({
      data: {
        id: uuidv7(), sourceProductId: dto.sourceProductId, targetProductId: dto.targetProductId, ruleType: dto.ruleType as never,
        conditionJson: dto.condition as never, paramsJson: dto.params as never, priority: dto.priority ?? 100, message: dto.message,
        validFrom: new Date(dto.validFrom), validTo: date(dto.validTo), isActive: dto.isActive ?? true,
      },
    });
    this.loader.invalidate();
    return this.ruleDto(r);
  }

  async updateRule(id: string, dto: UpdateRuleDto): Promise<RuleDto> {
    const cur = await this.prisma.cpqRule.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('Regra não encontrada');
    const merged = {
      sourceProductId: dto.sourceProductId ?? cur.sourceProductId, targetProductId: dto.targetProductId ?? cur.targetProductId ?? undefined,
      condition: dto.condition ?? ((cur.conditionJson as Record<string, unknown> | null) ?? undefined),
    };
    await this.assertRuleValid(merged, dto.ruleType ?? cur.ruleType);
    const r = await this.prisma.cpqRule.update({
      where: { id },
      data: {
        ...(dto.sourceProductId ? { sourceProductId: dto.sourceProductId } : {}),
        ...(dto.targetProductId !== undefined ? { targetProductId: dto.targetProductId } : {}),
        ...(dto.ruleType ? { ruleType: dto.ruleType as never } : {}),
        ...(dto.condition !== undefined ? { conditionJson: dto.condition as never } : {}),
        ...(dto.params !== undefined ? { paramsJson: dto.params as never } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.message !== undefined ? { message: dto.message } : {}),
        ...(dto.validFrom ? { validFrom: new Date(dto.validFrom) } : {}),
        ...(dto.validTo !== undefined ? { validTo: date(dto.validTo) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    this.loader.invalidate();
    return this.ruleDto(r);
  }

  /** As regras não se apagam (as cotações bloqueadas referenciam-nas nos snapshots): desativam-se. */
  async deactivateRule(id: string): Promise<void> {
    if (!(await this.prisma.cpqRule.count({ where: { id } }))) throw new NotFoundException('Regra não encontrada');
    await this.prisma.cpqRule.update({ where: { id }, data: { isActive: false } });
    this.loader.invalidate();
  }
}
