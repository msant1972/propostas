import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

export class CreateBlockDto {
  @ApiProperty() @IsString() @Length(1, 50) code!: string;
  @ApiProperty() @IsString() @Length(1, 255) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isLegal?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @ApiProperty({ default: 'pt-PT' }) @IsString() @Length(2, 5) language!: string;
  @ApiProperty({ description: 'HTML do editor (é sanitizado)' }) @IsString() @Length(1, 200000) bodyHtml!: string;
  @ApiProperty({ description: 'AAAA-MM-DD: data da próxima revisão obrigatória' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) reviewDueDate!: string;
}

export class UpdateBlockDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) title?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

export class CreateBlockVersionDto {
  @ApiProperty() @IsString() @Length(2, 5) language!: string;
  @ApiProperty() @IsString() @Length(1, 200000) bodyHtml!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) reviewDueDate!: string;
}

export class ListBlocksQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() tag?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() language?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
}

export class BlockVersionDto {
  @ApiProperty() id!: string;
  @ApiProperty() language!: string;
  @ApiProperty() versionNumber!: number;
  @ApiProperty({ enum: ['DRAFT', 'APPROVED', 'RETIRED'] }) status!: string;
  @ApiProperty() bodyHtml!: string;
  @ApiProperty() reviewDueDate!: string;
  @ApiProperty() reviewOverdue!: boolean;
}

export class BlockDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() title!: string;
  @ApiProperty() isLegal!: boolean;
  @ApiProperty({ type: [String] }) tags!: string[];
  @ApiProperty({ type: [BlockVersionDto] }) versions!: BlockVersionDto[];
}

export class BlockPageDto {
  @ApiProperty({ type: [BlockDto] }) items!: BlockDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class MergeTagDto {
  @ApiProperty() tag!: string;
  @ApiProperty() description!: string;
}

export class SetTagsDto {
  @ApiProperty({ type: [String] }) @IsArray() @IsString({ each: true }) tags!: string[];
}

export { IsUUID };
