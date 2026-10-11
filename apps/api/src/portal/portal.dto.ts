import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class CreateLinkDto {
  @ApiPropertyOptional({ description: 'Se indicado, envia a ligação por email a este endereço' }) @IsOptional() @IsEmail() sendTo?: string;
}

export class LinkCreatedDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'Mostrado só agora: depois só o hash fica guardado' }) url!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ nullable: true, type: String }) sentTo!: string | null;
}

export class LinkResponseDto {
  @ApiProperty({ enum: ['ACCEPTED', 'DECLINED'] }) decision!: string;
  @ApiProperty() signerName!: string;
  @ApiProperty() signerEmail!: string;
  @ApiProperty() decidedAt!: string;
}

export class LinkDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'RESPONDED'] }) status!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ nullable: true, type: String }) revokedAt!: string | null;
  @ApiProperty() openCount!: number;
  @ApiProperty({ nullable: true, type: String }) firstOpenedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastOpenedAt!: string | null;
  @ApiProperty({ nullable: true, type: LinkResponseDto }) response!: LinkResponseDto | null;
}

export class PortalViewDto {
  @ApiProperty() proposalCode!: string;
  @ApiProperty() proposalTitle!: string;
  @ApiProperty() clientName!: string;
  @ApiProperty({ nullable: true, type: String }) validUntil!: string | null;
  @ApiProperty() documentName!: string;
  @ApiProperty() documentSha256!: string;
  @ApiProperty() grandTotal!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: ['OPEN', 'ACCEPTED', 'DECLINED', 'CLOSED'] }) state!: string;
  @ApiProperty({ nullable: true, type: LinkResponseDto }) response!: LinkResponseDto | null;
  @ApiProperty({ nullable: true, type: String, description: 'Impressão digital SHA-256 do certificado do servidor, para o cliente confirmar' }) certificateFingerprint!: string | null;
}

export class PortalResponseDto {
  @ApiProperty({ enum: ['ACCEPTED', 'DECLINED'] }) @IsIn(['ACCEPTED', 'DECLINED']) decision!: 'ACCEPTED' | 'DECLINED';
  @ApiProperty() @IsString() @Length(2, 255) signerName!: string;
  @ApiProperty() @IsEmail() signerEmail!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 2000) comment?: string;
  @ApiProperty({ description: 'Declaração de que leu o documento (obrigatória para aceitar)' }) @IsBoolean() confirmRead!: boolean;
}
