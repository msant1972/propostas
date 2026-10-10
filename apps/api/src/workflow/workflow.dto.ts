import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export const EVENTS = ['COMPILE', 'EDIT', 'SUBMIT', 'RETURN', 'SEND', 'CUSTOMER_ACCEPT', 'CUSTOMER_REJECT', 'REVISE', 'REOPEN', 'CANCEL'] as const;

export class TransitionDto {
  @ApiProperty({ enum: EVENTS }) @IsIn(EVENTS) event!: (typeof EVENTS)[number];
  @ApiPropertyOptional({ description: 'Motivo (obrigatório em alguns eventos)' }) @IsOptional() @IsString() @Length(1, 500) reason?: string;
  @ApiPropertyOptional({ description: 'Confirmação explícita (obrigatória quando a ação invalida aprovações)' }) @IsOptional() @IsBoolean() confirm?: boolean;
}

export class TransitionResultDto {
  @ApiProperty() status!: string;
  @ApiProperty({ type: [String], description: 'Ações que o estado atual admite' }) availableEvents!: string[];
}

export class TimelineEntryDto {
  @ApiProperty() occurredAt!: string;
  @ApiProperty() action!: string;
  @ApiProperty({ nullable: true, type: String }) actorName!: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) detail!: Record<string, unknown>;
}

export class DecideDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED', 'RETURNED'] }) @IsIn(['APPROVED', 'REJECTED', 'RETURNED']) decision!: 'APPROVED' | 'REJECTED' | 'RETURNED';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) comment?: string;
}

export class ApprovalDecisionDto {
  @ApiProperty() level!: number;
  @ApiProperty() approverName!: string;
  @ApiProperty({ nullable: true, type: String }) onBehalfOfName!: string | null;
  @ApiProperty() decision!: string;
  @ApiProperty({ nullable: true, type: String }) comment!: string | null;
  @ApiProperty() decidedAt!: string;
}

export class ApprovalSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() proposalId!: string;
  @ApiProperty() proposalCode!: string;
  @ApiProperty() proposalTitle!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ enum: ['COMMERCIAL', 'LEGAL'] }) scope!: string;
  @ApiProperty() status!: string;
  @ApiProperty() currentLevel!: number;
  @ApiProperty() levelCount!: number;
  @ApiProperty({ nullable: true, type: String }) levelRole!: string | null;
  @ApiProperty({ nullable: true, type: String }) dueAt!: string | null;
  @ApiProperty() overdue!: boolean;
  @ApiProperty() grandTotal!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() requestedAt!: string;
  @ApiProperty() canDecide!: boolean;
}

export class ApprovalDetailDto extends ApprovalSummaryDto {
  @ApiProperty({ nullable: true, type: String }) marginPercent!: string | null;
  @ApiProperty() tcv!: string;
  @ApiProperty() maxLineDiscountPercent!: string;
  @ApiProperty() globalDiscountPercent!: string;
  @ApiProperty() policyName!: string;
  @ApiProperty({ type: [ApprovalDecisionDto] }) decisions!: ApprovalDecisionDto[];
  @ApiProperty({ nullable: true, type: String }) pdfDocumentId!: string | null;
  @ApiProperty({ nullable: true, type: String }) docxDocumentId!: string | null;
  @ApiProperty() snapshotHash!: string;
  @ApiProperty() ownerName!: string;
}

export class LevelDto {
  @ApiProperty() @IsInt() @Min(1) @Max(10) level!: number;
  @ApiProperty() @IsString() @Length(1, 50) role!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(24 * 30) slaHours!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() escalateToRole?: string;
}

export class CreatePolicyDto {
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
  @ApiProperty({ enum: ['COMMERCIAL', 'LEGAL'] }) @IsIn(['COMMERCIAL', 'LEGAL']) scope!: 'COMMERCIAL' | 'LEGAL';
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'JSONLogic; vazio = sempre' }) @IsOptional() @IsObject() condition?: Record<string, unknown>;
  @ApiProperty({ enum: ['SEQUENTIAL', 'PARALLEL'] }) @IsIn(['SEQUENTIAL', 'PARALLEL']) mode!: 'SEQUENTIAL' | 'PARALLEL';
  @ApiProperty({ type: [LevelDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => LevelDto) levels!: LevelDto[];
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @IsInt() @Min(0) @Max(32767) priority?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) validFrom!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validTo?: string;
}
export class UpdatePolicyDto extends PartialType(CreatePolicyDto) {}

export class PolicyDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() scope!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) condition!: Record<string, unknown> | null;
  @ApiProperty() mode!: string;
  @ApiProperty({ type: [LevelDto] }) levels!: LevelDto[];
  @ApiProperty() priority!: number;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() validFrom!: string;
  @ApiProperty({ nullable: true, type: String }) validTo!: string | null;
}

export class CreateDelegationDto {
  @ApiProperty() @IsUUID() toUserId!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) validFrom!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) validTo!: string;
}

export class DelegationDto {
  @ApiProperty() id!: string;
  @ApiProperty() toUserId!: string;
  @ApiProperty() toUserName!: string;
  @ApiProperty() validFrom!: string;
  @ApiProperty() validTo!: string;
}

export class UserOptionDto {
  @ApiProperty() id!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() email!: string;
}
