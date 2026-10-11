import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length } from 'class-validator';

export class LoginDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @IsString() @Length(1, 200) password!: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @Length(1, 200) currentPassword!: string;
  @ApiProperty() @IsString() @Length(1, 200) newPassword!: string;
}

export class SessionUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ type: [String] }) roles!: string[];
  @ApiProperty({ nullable: true, type: String }) teamId!: string | null;
  @ApiProperty() mustChangePassword!: boolean;
}

export class LoginResultDto {
  @ApiProperty() accessToken!: string;
  @ApiProperty() expiresAt!: string;
  @ApiProperty({ type: SessionUserDto }) user!: SessionUserDto;
}
