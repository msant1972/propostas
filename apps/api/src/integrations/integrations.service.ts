import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { uuidv7 } from '@cpq/shared';
import type { Actor } from '../authz/ability.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import { AuditService } from '../workflow/audit.service.js';
import type { ApiKeyCreatedDto, ApiKeyDto, CreateApiKeyDto, CrmClientDto, CrmProposalsPageDto, CrmSyncResultDto } from './integrations.dto.js';

const NIL = '00000000-0000-4000-8000-000000000000';

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly audit: AuditService,
  ) {}

  private dto(k: Awaited<ReturnType<Prisma['apiKey']['findFirstOrThrow']>>): ApiKeyDto {
    return { id: k.id, name: k.name, prefix: k.keyPrefix, scopes: k.scopes.split(','), createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null };
  }

  async listKeys(): Promise<ApiKeyDto[]> {
    return (await this.prisma.apiKey.findMany({ orderBy: { createdAt: 'desc' } })).map((k) => this.dto(k));
  }

  /** A chave completa só existe nesta resposta; na base de dados fica o hash. */
  async createKey(actor: Actor, dto: CreateApiKeyDto): Promise<ApiKeyCreatedDto> {
    const key = `cpq_${randomBytes(32).toString('base64url')}`;
    const row = await this.prisma.$transaction(async (tx) => {
      const r = await tx.apiKey.create({
        data: { id: uuidv7(), name: dto.name, keyPrefix: key.slice(0, 8), keyHash: createHash('sha256').update(key).digest('hex'), scopes: [...new Set(dto.scopes)].join(','), createdBy: actor.userId },
      });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'api_key', entityId: r.id, action: 'api_key.created', diff: { name: dto.name, scopes: dto.scopes } });
      return r;
    });
    return { ...this.dto(row), key };
  }

  async revokeKey(actor: Actor, id: string): Promise<void> {
    const k = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('Chave não encontrada');
    await this.prisma.$transaction(async (tx) => {
      await tx.apiKey.update({ where: { id }, data: { revokedAt: k.revokedAt ?? new Date() } });
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'api_key', entityId: id, action: 'api_key.revoked' });
    });
  }

  /**
   * Sincronização de clientes vindos do CRM (o CRM é quem empurra os dados): cria ou atualiza por `externalId`
   * e liga a clientes já existentes pelo código. Cada linha é independente: um erro não impede as restantes.
   */
  async syncClients(keyId: string, items: CrmClientDto[]): Promise<CrmSyncResultDto> {
    const out: CrmSyncResultDto = { created: 0, updated: 0, deleted: 0, errors: [] };
    const now = new Date();
    for (const [index, c] of items.entries()) {
      const fail = (code: string, message: string) => out.errors.push({ index, externalId: c.externalId, code, message });
      const code = (c.code ?? `CRM-${c.externalId}`).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 50);
      // Só se alteram os campos que o CRM enviou: omitir um campo não o apaga (enviar texto vazio apaga).
      const data = {
        name: c.name, countryCode: c.countryCode, crmSyncedAt: now,
        ...(c.vatNumber !== undefined ? { vatNumber: c.vatNumber || null } : {}),
        ...(c.tier !== undefined ? { tier: c.tier || null } : {}),
        ...(c.contactName !== undefined ? { contactName: c.contactName || null } : {}),
        ...(c.contactEmail !== undefined ? { contactEmail: c.contactEmail.toLowerCase() } : {}),
      };
      try {
        const byExternal = await this.prisma.client.findUnique({ where: { crmExternalId: c.externalId } });
        if (byExternal) {
          if (c.deleted) {
            await this.prisma.client.update({ where: { id: byExternal.id }, data: { deletedAt: byExternal.deletedAt ?? now, crmSyncedAt: now } });
            out.deleted++;
          } else {
            await this.prisma.client.update({ where: { id: byExternal.id }, data: { ...data, deletedAt: null } });
            out.updated++;
          }
          continue;
        }
        if (c.deleted) continue; // nada a eliminar: nunca foi sincronizado
        const byCode = await this.prisma.client.findUnique({ where: { code } });
        if (byCode) {
          if (byCode.crmExternalId) { fail('CODE_CONFLICT', `O código ${code} já pertence a outro cliente do CRM`); continue; }
          await this.prisma.client.update({ where: { id: byCode.id }, data: { ...data, crmExternalId: c.externalId, deletedAt: null } });
          out.updated++;
          continue;
        }
        await this.prisma.client.create({ data: { id: uuidv7(), code, crmExternalId: c.externalId, ...data } });
        out.created++;
      } catch (e) {
        fail('ERROR', e instanceof Error ? e.message.slice(0, 200) : 'erro');
      }
    }
    await this.prisma.$transaction((tx) => this.audit.record(tx, { actorUserId: null, entityType: 'api_key', entityId: keyId, action: 'crm.clients_synced', diff: { received: items.length, created: out.created, updated: out.updated, deleted: out.deleted, errors: out.errors.length } }));
    void NIL;
    return out;
  }

  /** Propostas alteradas desde `since`, para o CRM as ler (paginação pelo `nextSince`). */
  async proposalsFeed(since: string | undefined, pageSize: number): Promise<CrmProposalsPageDto> {
    const from = since ? new Date(since) : new Date(0);
    if (Number.isNaN(from.getTime())) return { items: [], nextSince: null };
    const rows = await this.prisma.proposal.findMany({ where: { updatedAt: { gt: from }, deletedAt: null }, orderBy: { updatedAt: 'asc' }, take: pageSize });
    const clients = new Map((await this.prisma.client.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.clientId))] } } })).map((c) => [c.id, c]));
    const versions = await this.prisma.quoteVersion.findMany({ where: { proposalId: { in: rows.map((r) => r.id) }, isCurrent: true } });
    const byProposal = new Map(versions.map((v) => [v.proposalId, v]));
    const items = rows.map((r) => ({
      id: r.id, code: r.code, title: r.title, status: r.status, clientExternalId: clients.get(r.clientId)?.crmExternalId ?? null, clientCode: clients.get(r.clientId)?.code ?? '',
      currency: r.currency, grandTotal: byProposal.get(r.id)?.grandTotal.toFixed(2) ?? '0.00', tcv: byProposal.get(r.id)?.totalTcv.toFixed(2) ?? '0.00',
      sentAt: r.sentAt?.toISOString() ?? null, updatedAt: r.updatedAt.toISOString(),
    }));
    return { items, nextSince: rows.length === pageSize ? rows[rows.length - 1]!.updatedAt.toISOString() : null };
  }
}
