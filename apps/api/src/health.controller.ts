import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Public } from './auth/public.decorator.js';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado do serviço' })
  health() {
    return { status: 'ok' };
  }
}
