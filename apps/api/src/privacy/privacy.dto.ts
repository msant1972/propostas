import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEmail } from 'class-validator';

export class PrivacyRequestDto {
  @ApiProperty({ description: 'Email do titular dos dados' }) @IsEmail() email!: string;
}

export class AnonymizeDto extends PrivacyRequestDto {
  @ApiProperty({ description: 'Confirmação explícita: a operação não é reversível' }) @IsBoolean() confirm!: boolean;
}

export class PrivacyExportDto {
  @ApiProperty() email!: string;
  @ApiProperty() generatedAt!: string;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) clients!: object[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) customerResponses!: object[];
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } }) users!: object[];
}

export class AnonymizeResultDto {
  @ApiProperty() clients!: number;
  @ApiProperty() customerResponses!: number;
  @ApiProperty() users!: number;
}
