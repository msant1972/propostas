import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';

const DECIMAL = /^\d{1,12}(\.\d{1,3})?$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

export class CreateProposalDto {
  @ApiProperty() @IsString() @Length(1, 255) title!: string;
  @ApiProperty() @IsUUID() clientId!: string;
  @ApiPropertyOptional({ default: 'EUR' }) @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @ApiPropertyOptional({ default: 'pt-PT' }) @IsOptional() @IsString() @Length(2, 5) language?: string;
  @ApiPropertyOptional({ description: 'AAAA-MM-DD' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string;
}

export class UpdateProposalDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 5) language?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string;
}

export class ListProposalsQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() clientId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
}

export class ProposalDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() clientId!: string;
  @ApiProperty() ownerUserId!: string;
  @ApiProperty() status!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() language!: string;
  @ApiProperty({ nullable: true, type: String }) validUntil!: string | null;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) statusReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) sentAt!: string | null;
}

export class ProposalPageDto {
  @ApiProperty({ type: [ProposalDto] }) items!: ProposalDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class QuoteLineDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ description: 'Decimal em texto, até 3 casas' }) @Matches(DECIMAL) quantity!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(600) termMonths?: number;
  @ApiPropertyOptional() @IsOptional() @Matches(PERCENT) discountPercent?: string;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional() @IsObject() attributes?: Record<string, string | number | boolean>;
}

export class SaveQuoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(['direct', 'partner', 'online']) channel?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(PERCENT) globalDiscountPercent?: string;
  @ApiProperty({ type: [QuoteLineDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteLineDto) lines!: QuoteLineDto[];
}

export class ViolationDto {
  @ApiProperty({ nullable: true, type: String }) ruleId!: string | null;
  @ApiProperty() code!: string;
  @ApiProperty({ enum: ['error', 'warning', 'info'] }) severity!: string;
  @ApiProperty({ nullable: true, type: Number }) lineNumber!: number | null;
  @ApiProperty() message!: string;
}

export class QuoteLineResultDto {
  @ApiProperty() lineNumber!: number;
  @ApiProperty() productId!: string;
  @ApiProperty() productName!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty({ nullable: true, type: Number }) termMonths!: number | null;
  @ApiProperty() listUnitPrice!: string;
  @ApiProperty() discountPercent!: string;
  @ApiProperty() netUnitPrice!: string;
  @ApiProperty() globalDiscountAmount!: string;
  @ApiProperty() taxRatePercent!: string;
  @ApiProperty() taxRegime!: string;
  @ApiProperty() taxAmount!: string;
  @ApiProperty() lineTotal!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) attributes!: Record<string, unknown> | null;
}

export class QuoteTotalsDto {
  @ApiProperty() subtotal!: string;
  @ApiProperty() discountAmount!: string;
  @ApiProperty() totalTax!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty() mrr!: string;
  @ApiProperty() tcv!: string;
  @ApiProperty({ nullable: true, type: String }) marginPercent!: string | null;
}

export class QuoteVersionDto {
  @ApiProperty() id!: string;
  @ApiProperty() proposalId!: string;
  @ApiProperty() versionNumber!: number;
  @ApiProperty({ enum: ['DRAFT', 'LOCKED', 'SUPERSEDED'] }) status!: string;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty() currency!: string;
  @ApiProperty() priceListId!: string;
  @ApiProperty() globalDiscountPercent!: string;
  @ApiProperty({ type: QuoteTotalsDto }) totals!: QuoteTotalsDto;
  @ApiProperty({ type: [QuoteLineResultDto] }) lines!: QuoteLineResultDto[];
  @ApiProperty({ nullable: true, type: String }) snapshotHash!: string | null;
  @ApiProperty({ nullable: true, type: String }) lockedAt!: string | null;
  @ApiProperty({ type: [ViolationDto] }) violations!: ViolationDto[];
}

export class QuoteVersionSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() versionNumber!: number;
  @ApiProperty() status!: string;
  @ApiProperty() isCurrent!: boolean;
  @ApiProperty() grandTotal!: string;
  @ApiProperty() totalTcv!: string;
  @ApiProperty({ nullable: true, type: String }) marginPercent!: string | null;
  @ApiProperty({ nullable: true, type: String }) snapshotHash!: string | null;
  @ApiProperty() createdAt!: string;
}

export class QuotePreviewDto extends SaveQuoteDto {
  @ApiProperty() @IsUUID() proposalId!: string;
}

export class VerifyQuoteDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty({ nullable: true, type: String }) storedHash!: string | null;
  @ApiProperty({ nullable: true, type: String }) recomputedHash!: string | null;
}

export class QuotePreviewResultDto {
  @ApiProperty() valid!: boolean;
  @ApiProperty() priceListId!: string;
  @ApiProperty({ type: QuoteTotalsDto }) totals!: QuoteTotalsDto;
  @ApiProperty({ type: [QuoteLineResultDto] }) lines!: QuoteLineResultDto[];
  @ApiProperty({ type: [ViolationDto] }) violations!: ViolationDto[];
}
