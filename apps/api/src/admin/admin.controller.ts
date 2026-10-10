import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckAbility } from '../authz/authz.js';
import { ProductDto } from '../catalog/catalog.dto.js';
import {
  CreatePriceListDto, CreateProductDto, CreateRuleDto, CreateTaxRateDto, FxRateDto, PriceListDto, PriceListItemDto,
  ReplaceAttributesDto, ReplaceBundleDto, ReplacePriceListItemsDto, RuleDto, TaxRateDto, UpdatePriceListDto,
  UpdateProductDto, UpdateRuleDto, UpsertFxRateDto,
} from './admin.dto.js';
import { AdminService } from './admin.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Controller()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  // Produtos (leitura em /catalog/products)
  @Post('catalog/products') @CheckAbility('create', 'Product')
  @ApiOperation({ operationId: 'createProduct' }) @ApiCreatedResponse({ type: ProductDto })
  async createProduct(@Body() dto: CreateProductDto) {
    const p = await this.admin.createProduct(dto);
    return { id: p.id };
  }

  @Patch('catalog/products/:id') @CheckAbility('update', 'Product')
  @ApiOperation({ operationId: 'updateProduct' })
  async updateProduct(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    const p = await this.admin.updateProduct(id, dto);
    return { id: p.id };
  }

  @Put('catalog/products/:id/attributes') @HttpCode(204) @CheckAbility('update', 'Product')
  @ApiOperation({ operationId: 'replaceProductAttributes' })
  replaceAttributes(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceAttributesDto) {
    return this.admin.replaceAttributes(id, dto);
  }

  @Put('catalog/products/:id/bundle') @HttpCode(204) @CheckAbility('update', 'Product')
  @ApiOperation({ operationId: 'replaceProductBundle' })
  replaceBundle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceBundleDto) {
    return this.admin.replaceBundle(id, dto);
  }

  // Listas de preços
  @Get('price-lists') @CheckAbility('read', 'PriceList')
  @ApiOperation({ operationId: 'listPriceLists' }) @ApiOkResponse({ type: [PriceListDto] })
  listPriceLists() {
    return this.admin.listPriceLists();
  }

  @Post('price-lists') @CheckAbility('create', 'PriceList')
  @ApiOperation({ operationId: 'createPriceList' }) @ApiCreatedResponse({ type: PriceListDto })
  createPriceList(@Body() dto: CreatePriceListDto) {
    return this.admin.createPriceList(dto);
  }

  @Patch('price-lists/:id') @CheckAbility('update', 'PriceList')
  @ApiOperation({ operationId: 'updatePriceList' }) @ApiOkResponse({ type: PriceListDto })
  updatePriceList(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePriceListDto) {
    return this.admin.updatePriceList(id, dto);
  }

  @Get('price-lists/:id/items') @CheckAbility('read', 'PriceList')
  @ApiOperation({ operationId: 'listPriceListItems' }) @ApiOkResponse({ type: [PriceListItemDto] })
  items(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.priceListItems(id);
  }

  @Put('price-lists/:id/items') @HttpCode(204) @CheckAbility('update', 'PriceList')
  @ApiOperation({ operationId: 'replacePriceListItems' })
  replaceItems(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplacePriceListItemsDto) {
    return this.admin.replacePriceListItems(id, dto);
  }

  // Impostos e câmbios
  @Get('tax-rates') @CheckAbility('read', 'TaxRate')
  @ApiOperation({ operationId: 'listTaxRates' }) @ApiOkResponse({ type: [TaxRateDto] })
  listTaxRates() {
    return this.admin.listTaxRates();
  }

  @Post('tax-rates') @CheckAbility('create', 'TaxRate')
  @ApiOperation({ operationId: 'createTaxRate' }) @ApiCreatedResponse({ type: TaxRateDto })
  createTaxRate(@Body() dto: CreateTaxRateDto) {
    return this.admin.createTaxRate(dto);
  }

  @Get('fx-rates') @CheckAbility('read', 'FxRate')
  @ApiOperation({ operationId: 'listFxRates' }) @ApiOkResponse({ type: [FxRateDto] })
  listFxRates() {
    return this.admin.listFxRates();
  }

  @Put('fx-rates') @CheckAbility('create', 'FxRate')
  @ApiOperation({ operationId: 'upsertFxRate' }) @ApiOkResponse({ type: FxRateDto })
  upsertFxRate(@Body() dto: UpsertFxRateDto) {
    return this.admin.upsertFxRate(dto);
  }

  // Regras CPQ
  @Get('rules') @CheckAbility('read', 'Rule')
  @ApiOperation({ operationId: 'listRules' }) @ApiOkResponse({ type: [RuleDto] })
  listRules() {
    return this.admin.listRules();
  }

  @Post('rules') @CheckAbility('create', 'Rule')
  @ApiOperation({ operationId: 'createRule' }) @ApiCreatedResponse({ type: RuleDto })
  createRule(@Body() dto: CreateRuleDto) {
    return this.admin.createRule(dto);
  }

  @Patch('rules/:id') @CheckAbility('update', 'Rule')
  @ApiOperation({ operationId: 'updateRule' }) @ApiOkResponse({ type: RuleDto })
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRuleDto) {
    return this.admin.updateRule(id, dto);
  }

  @Delete('rules/:id') @HttpCode(204) @CheckAbility('delete', 'Rule')
  @ApiOperation({ operationId: 'deactivateRule', summary: 'Desativa a regra (não se apagam: os snapshots referenciam-nas)' })
  deactivateRule(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deactivateRule(id);
  }
}
