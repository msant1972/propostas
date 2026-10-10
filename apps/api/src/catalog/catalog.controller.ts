import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CheckAbility } from '../authz/authz.js';
import { ListProductsQuery, ProductDto, ProductPageDto } from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('catalog/products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @CheckAbility('read', 'Product')
  @ApiOperation({ operationId: 'listProducts', summary: 'Lista produtos do catálogo' })
  @ApiOkResponse({ type: ProductPageDto })
  list(@Query() q: ListProductsQuery) {
    return this.catalog.list(q);
  }

  @Get(':id')
  @CheckAbility('read', 'Product')
  @ApiOperation({ operationId: 'getProduct', summary: 'Detalhe de um produto' })
  @ApiOkResponse({ type: ProductDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.get(id);
  }
}
