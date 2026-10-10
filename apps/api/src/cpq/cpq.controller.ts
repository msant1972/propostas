import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { AppAbility } from '../authz/ability.js';
import { CheckAbility, CurrentAbility } from '../authz/authz.js';
import { CatalogLoader } from './catalog-loader.js';

class EngineCatalogDto {
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) products!: object[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) priceLists!: object[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) taxRates!: object[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) fxRates!: object[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) rules!: object[];
}

@ApiTags('cpq')
@ApiBearerAuth()
@Controller('cpq')
export class CpqController {
  constructor(private readonly loader: CatalogLoader) {}

  /** Catálogo no formato do motor partilhado, para a UI avaliar regras e preços localmente. */
  @Get('catalog')
  @CheckAbility('read', 'Product')
  @ApiOperation({ operationId: 'getEngineCatalog' })
  @ApiOkResponse({ type: EngineCatalogDto })
  async catalog(@CurrentAbility() ability: AppAbility) {
    const catalog = await this.loader.load();
    if (ability.can('read', 'Cost')) return catalog;
    // Sem permissão para custos: o browser recebe custo 0 (a margem não é mostrada nem calculada).
    return { ...catalog, products: catalog.products.map((p) => ({ ...p, unitCost: '0' })) };
  }
}
