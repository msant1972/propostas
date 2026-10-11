import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { ROLES } from '@cpq/shared/roles';

export class CreateUserDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @Length(1, 255) displayName!: string;
  @ApiProperty({ type: [String], enum: ROLES }) @IsArray() @ArrayMaxSize(5) @IsIn(ROLES, { each: true }) roles!: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 50) region?: string;
  @ApiPropertyOptional({ description: 'Se omitida, é gerada uma palavra-passe temporária' }) @IsOptional() @IsString() @Length(1, 200) password?: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 255) displayName?: string;
  @ApiPropertyOptional({ type: [String], enum: ROLES }) @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(ROLES, { each: true }) roles?: string[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsUUID() teamId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(0, 50) region?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ListUsersQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize: number = 50;
}

export class UserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ nullable: true, type: String }) teamId!: string | null;
  @ApiProperty({ nullable: true, type: String }) teamName!: string | null;
  @ApiProperty({ nullable: true, type: String }) region!: string | null;
  @ApiProperty() isActive!: boolean;
  @ApiProperty() mustChangePassword!: boolean;
  @ApiProperty() locked!: boolean;
  @ApiProperty({ nullable: true, type: String }) lastLoginAt!: string | null;
}

export class UserPageDto {
  @ApiProperty({ type: [UserDto] }) items!: UserDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() pageSize!: number;
}

export class UserWithPasswordDto {
  @ApiProperty({ type: UserDto }) user!: UserDto;
  @ApiProperty({ nullable: true, type: String, description: 'Palavra-passe temporária; só é mostrada uma vez' }) temporaryPassword!: string | null;
}

export class TeamDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class CreateTeamDto {
  @ApiProperty() @IsString() @Length(1, 100) name!: string;
}
