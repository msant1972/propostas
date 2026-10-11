import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Public } from './auth/public.decorator.js';
import { PRISMA, type Prisma } from './prisma/prisma.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Estado do serviço (o processo está vivo)' })
  health() {
    return { status: 'ok' };
  }

  /** Pronto para receber pedidos: a base de dados responde (a API só fala com o Redis através do worker/outbox). */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Estado de prontidão (verifica a base de dados)' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Base de dados indisponível');
    }
    return { status: 'ok', database: 'ok' };
  }
}
