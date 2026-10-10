import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateClientDto {
  @ApiProperty() @IsString() @Length(1, 50) code!: string;
  @ApiProperty() @IsString() @Length(1, 255) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) vatNumber?: string;
  @ApiProperty({ description: 'ISO 3166-1 alpha-2' }) @IsString() @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) tier?: string;
  @ApiPropertyOptional({ description: 'VAT intracomunitário validado (VIES)' }) @IsOptional() @IsBoolean() vatValid?: boolean;
}

export class UpdateClientDto extends PartialType(CreateClientDto) {}

export class ListClientsQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize: number = 20;
}

export class ClientDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) vatNumber!: string | null;
  @ApiProperty() countryCode!: string;
  @ApiProperty({ nullable: true, type: String }) tier!: string | null;
  @ApiProperty() vatValid!: boolean;
}

export class ClientPageDto {
  @ApiProperty({ type: [ClientDto] }) items!: ClientDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}
