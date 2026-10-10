import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@cpq/shared';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type { ClientDto, ClientPageDto, CreateClientDto, ListClientsQuery, UpdateClientDto } from './clients.dto.js';

const select = { id: true, code: true, name: true, vatNumber: true, countryCode: true, tier: true, vatValid: true } as const;

@Injectable()
export class ClientsService {
  constructor(@Inject(PRISMA) private readonly prisma: Prisma) {}

  async list(q: ListClientsQuery): Promise<ClientPageDto> {
    const where = {
      deletedAt: null,
      ...(q.q ? { OR: [{ name: { contains: q.q } }, { code: { contains: q.q } }, { vatNumber: { contains: q.q } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({ where, select, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.client.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async get(id: string): Promise<ClientDto> {
    const c = await this.prisma.client.findFirst({ where: { id, deletedAt: null }, select });
    if (!c) throw new NotFoundException('Cliente não encontrado');
    return c;
  }

  async create(dto: CreateClientDto): Promise<ClientDto> {
    const exists = await this.prisma.client.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('Já existe um cliente com esse código');
    return this.prisma.client.create({ data: { id: uuidv7(), ...dto }, select });
  }

  async update(id: string, dto: UpdateClientDto): Promise<ClientDto> {
    await this.get(id);
    if (dto.code) {
      const clash = await this.prisma.client.findFirst({ where: { code: dto.code, NOT: { id } } });
      if (clash) throw new ConflictException('Já existe um cliente com esse código');
    }
    return this.prisma.client.update({ where: { id }, data: dto, select });
  }

  /** Eliminação lógica: o histórico de propostas mantém a referência. */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.prisma.client.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
