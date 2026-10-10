import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListProductsQuery {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize: number = 20;

  @ApiPropertyOptional({ description: 'Filtrar por produtos ativos/inativos' })
  @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean()
  active?: boolean;
}

export class ProductDto {
  @ApiProperty() id!: string;
  @ApiProperty() sku!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty() unitOfMeasure!: string;
  @ApiProperty({ enum: ['ONE_TIME', 'RECURRING', 'USAGE_BASED', 'MILESTONE'] }) billingModel!: string;
  @ApiProperty({ enum: ['MONTH', 'QUARTER', 'YEAR'], nullable: true }) billingPeriod!: string | null;
  @ApiProperty() isActive!: boolean;
}

export class ProductPageDto {
  @ApiProperty({ type: [ProductDto] }) items!: ProductDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
