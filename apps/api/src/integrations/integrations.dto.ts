import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export const SCOPES = ['clients:write', 'proposals:read'] as const;

export class CreateApiKeyDto {
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
  @ApiProperty({ type: [String], enum: SCOPES }) @IsArray() @ArrayMaxSize(2) @IsIn(SCOPES, { each: true }) scopes!: string[];
}

export class ApiKeyDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Primeiros caracteres da chave, para a identificar' }) prefix!: string;
  @ApiProperty({ type: [String] }) scopes!: string[];
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) lastUsedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) revokedAt!: string | null;
}

export class ApiKeyCreatedDto extends ApiKeyDto {
  @ApiProperty({ description: 'A chave completa: só é mostrada agora' }) key!: string;
}

export class CrmClientDto {
  @ApiProperty() @IsString() @Length(1, 100) externalId!: string;
  @ApiPropertyOptional({ description: 'Se omitido, gera-se CRM-<externalId>' }) @IsOptional() @IsString() @Length(1, 50) code?: string;
  @ApiProperty() @IsString() @Length(1, 255) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 30) vatNumber?: string;
  @ApiProperty() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 30) tier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 255) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() contactEmail?: string;
  @ApiPropertyOptional({ description: 'Marca o cliente como eliminado (eliminação lógica)' }) @IsOptional() @IsBoolean() deleted?: boolean;
}

export class CrmSyncDto {
  @ApiProperty({ type: [CrmClientDto] }) @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CrmClientDto) clients!: CrmClientDto[];
}

export class CrmSyncErrorDto {
  @ApiProperty() index!: number;
  @ApiProperty() externalId!: string;
  @ApiProperty() code!: string;
  @ApiProperty() message!: string;
}

export class CrmSyncResultDto {
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty() deleted!: number;
  @ApiProperty({ type: [CrmSyncErrorDto] }) errors!: CrmSyncErrorDto[];
}

export class CrmProposalsQuery {
  @ApiPropertyOptional({ description: 'ISO 8601: só propostas alteradas depois deste instante' }) @IsOptional() @IsString() since?: string;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) pageSize: number = 100;
}

export class CrmProposalDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ nullable: true, type: String }) clientExternalId!: string | null;
  @ApiProperty() clientCode!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty() tcv!: string;
  @ApiProperty({ nullable: true, type: String }) sentAt!: string | null;
  @ApiProperty() updatedAt!: string;
}

export class CrmProposalsPageDto {
  @ApiProperty({ type: [CrmProposalDto] }) items!: CrmProposalDto[];
  @ApiProperty({ nullable: true, type: String, description: 'Use como `since` no pedido seguinte' }) nextSince!: string | null;
}
