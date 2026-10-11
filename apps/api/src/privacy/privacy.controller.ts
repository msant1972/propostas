import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../authz/ability.js';
import { CheckAbility, CurrentActor } from '../authz/authz.js';
import { AnonymizeDto, AnonymizeResultDto, PrivacyExportDto, PrivacyRequestDto } from './privacy.dto.js';
import { PrivacyService } from './privacy.service.js';

@ApiTags('privacy')
@ApiBearerAuth()
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post('export') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'privacyExport', summary: 'Exporta os dados pessoais de um titular' }) @ApiCreatedResponse({ type: PrivacyExportDto })
  export(@CurrentActor() a: Actor, @Body() dto: PrivacyRequestDto) {
    return this.privacy.export(a, dto.email);
  }

  @Post('anonymize') @CheckAbility('manage', 'User')
  @ApiOperation({ operationId: 'privacyAnonymize', summary: 'Anonimiza os dados pessoais de um titular (irreversível)' }) @ApiCreatedResponse({ type: AnonymizeResultDto })
  anonymize(@CurrentActor() a: Actor, @Body() dto: AnonymizeDto) {
    return this.privacy.anonymize(a, dto.email, dto.confirm);
  }
}
