import { Body, Controller, Inject, NotFoundException, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { IsArray, IsEmail, IsIn, IsString } from 'class-validator';
import { ROLES, type Role } from '@cpq/shared';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { Public } from './public.decorator.js';
import { TOKEN_VERIFIER } from './auth.guard.js';
import { DevTokenVerifier } from './token-verifier.js';

class DevTokenDto {
  @IsString() oid!: string;
  @IsEmail() email!: string;
  @IsString() name!: string;
  @IsArray() @IsIn(ROLES, { each: true }) roles!: Role[];
}

/** Só existe com AUTH_MODE=dev (nunca em produção, ver validateEnv). */
@ApiExcludeController()
@Controller('dev')
export class DevAuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(TOKEN_VERIFIER) private readonly verifier: DevTokenVerifier,
  ) {}

  @Public()
  @Post('token')
  async token(@Body() dto: DevTokenDto) {
    if (this.env.AUTH_MODE !== 'dev') throw new NotFoundException();
    return { accessToken: await this.verifier.issue(dto) };
  }
}
