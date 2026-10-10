import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';

const DEC = /^\d{1,11}(\.\d{1,4})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BILLING = ['ONE_TIME', 'RECURRING', 'USAGE_BASED', 'MILESTONE'];
const PERIOD = ['MONTH', 'QUARTER', 'YEAR'];
const TAXCAT = ['STANDARD', 'REDUCED', 'EXEMPT', 'OUTSIDE_SCOPE'];

export class CreateProductDto {
  @ApiProperty() @IsString() @Length(1, 50) sku!: string;
  @ApiProperty() @IsString() @Length(1, 255) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional({ default: 'UN' }) @IsOptional() @IsString() @Length(1, 20) unitOfMeasure?: string;
  @ApiProperty({ enum: BILLING }) @IsIn(BILLING) billingModel!: string;
  @ApiPropertyOptional({ enum: PERIOD }) @IsOptional() @IsIn(PERIOD) billingPeriod?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) unitCost?: string;
  @ApiPropertyOptional({ default: 'EUR' }) @IsOptional() @Matches(/^[A-Z]{3}$/) costCurrency?: string;
  @ApiPropertyOptional({ enum: TAXCAT }) @IsOptional() @IsIn(TAXCAT) taxCategory?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class AttributeDto {
  @ApiProperty() @IsString() @Length(1, 50) code!: string;
  @ApiProperty() @IsString() @Length(1, 100) label!: string;
  @ApiProperty({ enum: ['INTEGER', 'DECIMAL', 'LIST', 'BOOLEAN'] }) @IsIn(['INTEGER', 'DECIMAL', 'LIST', 'BOOLEAN']) dataType!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) minValue?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) maxValue?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) stepValue?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) allowedValues?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultValue?: string;
}
export class ReplaceAttributesDto {
  @ApiProperty({ type: [AttributeDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => AttributeDto) attributes!: AttributeDto[];
}

export class BundleItemDto {
  @ApiProperty() @IsUUID() componentProductId!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRequired?: boolean;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) defaultQuantity?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) minQuantity?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DEC) maxQuantity?: string;
}
export class ReplaceBundleDto {
  @ApiProperty({ type: [BundleItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => BundleItemDto) items!: BundleItemDto[];
}

export class PriceListItemDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiPropertyOptional({ default: '0' }) @IsOptional() @Matches(DEC) minQuantity?: string;
  @ApiProperty() @Matches(DEC) unitPrice!: string;
}
export class CreatePriceListDto {
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
  @ApiProperty() @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() channel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() clientTier?: string;
  @ApiProperty() @Matches(DATE) validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) validTo?: string;
}
export class UpdatePriceListDto extends PartialType(CreatePriceListDto) {}
export class ReplacePriceListItemsDto {
  @ApiProperty({ type: [PriceListItemDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => PriceListItemDto) items!: PriceListItemDto[];
}
export class PriceListDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: String }) region!: string | null;
  @ApiProperty({ nullable: true, type: String }) channel!: string | null;
  @ApiProperty({ nullable: true, type: String }) clientTier!: string | null;
  @ApiProperty() validFrom!: string;
  @ApiProperty({ nullable: true, type: String }) validTo!: string | null;
  @ApiProperty() itemCount!: number;
}

export class CreateTaxRateDto {
  @ApiProperty() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @ApiPropertyOptional({ enum: TAXCAT }) @IsOptional() @IsIn(TAXCAT) taxCategory?: string;
  @ApiProperty({ enum: ['STANDARD', 'REDUCED', 'EXEMPT', 'REVERSE_CHARGE', 'OUTSIDE_SCOPE'] }) @IsIn(['STANDARD', 'REDUCED', 'EXEMPT', 'REVERSE_CHARGE', 'OUTSIDE_SCOPE']) regime!: string;
  @ApiProperty() @Matches(/^\d{1,3}(\.\d{1,2})?$/) ratePercent!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() exemptionReason?: string;
  @ApiProperty() @Matches(DATE) validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) validTo?: string;
}
export class TaxRateDto {
  @ApiProperty() id!: string;
  @ApiProperty() countryCode!: string;
  @ApiProperty() taxCategory!: string;
  @ApiProperty() regime!: string;
  @ApiProperty() ratePercent!: string;
  @ApiProperty() validFrom!: string;
  @ApiProperty({ nullable: true, type: String }) validTo!: string | null;
}

export class UpsertFxRateDto {
  @ApiProperty() @Matches(/^[A-Z]{3}$/) baseCurrency!: string;
  @ApiProperty() @Matches(/^[A-Z]{3}$/) quoteCurrency!: string;
  @ApiProperty() @Matches(/^\d{1,10}(\.\d{1,8})?$/) rate!: string;
  @ApiProperty() @Matches(DATE) rateDate!: string;
  @ApiProperty() @IsString() @Length(1, 50) source!: string;
}
export class FxRateDto {
  @ApiProperty() id!: string;
  @ApiProperty() baseCurrency!: string;
  @ApiProperty() quoteCurrency!: string;
  @ApiProperty() rate!: string;
  @ApiProperty() rateDate!: string;
  @ApiProperty() source!: string;
}

export class CreateRuleDto {
  @ApiProperty() @IsUUID() sourceProductId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() targetProductId?: string;
  @ApiProperty({ enum: ['REQUIRES', 'EXCLUDES', 'RECOMMENDS', 'CONSTRAINT', 'DEFAULT'] }) @IsIn(['REQUIRES', 'EXCLUDES', 'RECOMMENDS', 'CONSTRAINT', 'DEFAULT']) ruleType!: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Condição JSONLogic' }) @IsOptional() @IsObject() condition?: Record<string, unknown>;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true }) @IsOptional() @IsObject() params?: Record<string, unknown>;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @IsInt() @Min(0) @Max(32767) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) message?: string;
  @ApiProperty() @Matches(DATE) validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) validTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateRuleDto extends PartialType(CreateRuleDto) {}
export class RuleDto {
  @ApiProperty() id!: string;
  @ApiProperty() sourceProductId!: string;
  @ApiProperty({ nullable: true, type: String }) targetProductId!: string | null;
  @ApiProperty() ruleType!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) condition!: Record<string, unknown> | null;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) params!: Record<string, unknown> | null;
  @ApiProperty() priority!: number;
  @ApiProperty({ nullable: true, type: String }) message!: string | null;
  @ApiProperty() validFrom!: string;
  @ApiProperty({ nullable: true, type: String }) validTo!: string | null;
  @ApiProperty() isActive!: boolean;
}
