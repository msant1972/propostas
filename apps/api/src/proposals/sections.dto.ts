import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class AddSectionDto {
  @ApiPropertyOptional({ description: 'Versão aprovada de um bloco da biblioteca' }) @IsOptional() @IsUUID() blockVersionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) title?: string;
}

export class UpdateSectionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) title?: string;
  @ApiPropertyOptional({ description: 'HTML do editor (é sanitizado)' }) @IsOptional() @IsString() @Length(0, 200000) html?: string;
  @ApiProperty({ description: 'Bloqueio otimista: versão da secção que o cliente viu' }) @IsInt() @Min(1) rowVersion!: number;
}

export class ReorderSectionsDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID(undefined, { each: true }) orderedIds!: string[];
}

export class SectionDto {
  @ApiProperty() id!: string;
  @ApiProperty() position!: number;
  @ApiProperty() title!: string;
  @ApiProperty() html!: string;
  @ApiProperty() isModified!: boolean;
  @ApiProperty() isLegal!: boolean;
  @ApiProperty({ nullable: true, type: String }) blockVersionId!: string | null;
  @ApiProperty({ nullable: true, type: String }) blockCode!: string | null;
  @ApiProperty() rowVersion!: number;
}

export class DocumentDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['DOCX', 'PDF', 'SIGNED_PDF', 'ATTACHMENT'] }) kind!: string;
  @ApiProperty({ enum: ['GENERATED', 'MANUALLY_EDITED', 'UPLOADED'] }) origin!: string;
  @ApiProperty() folder!: string;
  @ApiProperty() fileName!: string;
  @ApiProperty() sha256!: string;
  @ApiProperty() sizeBytes!: number;
  @ApiProperty({ nullable: true, type: String }) quoteVersionId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class CompileAcceptedDto {
  @ApiProperty() eventId!: string;
}

export class JobStatusDto {
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] }) status!: string;
  @ApiProperty({ nullable: true, type: String }) error!: string | null;
}
