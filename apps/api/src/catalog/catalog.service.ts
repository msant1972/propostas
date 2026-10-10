import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type { ListProductsQuery, ProductDto, ProductPageDto } from './catalog.dto.js';

const select = {
  id: true,
  sku: true,
  name: true,
  description: true,
  unitOfMeasure: true,
  billingModel: true,
  billingPeriod: true,
  isActive: true,
} as const; // o custo unitário não sai nunca por esta via (margem é informação restrita)

@Injectable()
export class CatalogService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async list(q: ListProductsQuery): Promise<ProductPageDto> {
    const where = q.active === undefined ? {} : { isActive: q.active };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select,
        orderBy: { sku: 'asc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string): Promise<ProductDto> {
    const product = await this.prisma.product.findUnique({ where: { id }, select });
    if (!product) throw new NotFoundException('Produto não encontrado');
    return product;
  }
}
