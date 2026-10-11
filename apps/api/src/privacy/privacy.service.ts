import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Actor } from '../authz/ability.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import { UsersService } from '../users/users.service.js';
import { AuditService } from '../workflow/audit.service.js';
import type { AnonymizeResultDto, PrivacyExportDto } from './privacy.dto.js';

/** Direitos do titular (RGPD): exportar e anonimizar. Mantém-se o que a lei manda conservar (decisões, hashes, valores). */
@Injectable()
export class PrivacyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    private readonly sessions: UsersService,
    private readonly audit: AuditService,
  ) {}

  async export(actor: Actor, emailRaw: string): Promise<PrivacyExportDto> {
    const email = emailRaw.trim().toLowerCase();
    const [clients, responses, users] = await Promise.all([
      this.prisma.client.findMany({ where: { contactEmail: email } }),
      this.prisma.customerResponse.findMany({ where: { signerEmail: email }, orderBy: { decidedAt: 'asc' } }),
      this.prisma.user.findMany({ where: { email } }),
    ]);
    const proposals = new Map((await this.prisma.proposal.findMany({ where: { id: { in: responses.map((r) => r.proposalId) } } })).map((p) => [p.id, p]));
    // O exportado não contém o hash da palavra-passe nem outros segredos.
    const out: PrivacyExportDto = {
      email, generatedAt: new Date().toISOString(),
      clients: clients.map((c) => ({ id: c.id, code: c.code, name: c.name, contactName: c.contactName, contactEmail: c.contactEmail })),
      customerResponses: responses.map((r) => ({ proposal: proposals.get(r.proposalId)?.code ?? null, decision: r.decision, signerName: r.signerName, signerEmail: r.signerEmail, comment: r.comment, ipAddress: r.ipAddress, userAgent: r.userAgent, decidedAt: r.decidedAt.toISOString() })),
      users: users.map((u) => ({ id: u.id, email: u.email, displayName: u.displayName, roles: u.rolesJson, region: u.region, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })),
    };
    await this.prisma.$transaction((tx) => this.audit.record(tx, { actorUserId: actor.userId, entityType: 'privacy', entityId: actor.userId, action: 'privacy.exported', diff: { clients: clients.length, responses: responses.length, users: users.length } }));
    return out;
  }

  async anonymize(actor: Actor, emailRaw: string, confirm: boolean): Promise<AnonymizeResultDto> {
    if (!confirm) throw new UnprocessableEntityException('Confirme a operação: não é reversível');
    const email = emailRaw.trim().toLowerCase();
    const targetUsers = await this.prisma.user.findMany({ where: { email } });
    if (targetUsers.some((u) => u.id === actor.userId)) throw new UnprocessableEntityException('Não pode anonimizar o seu próprio utilizador');

    const res = await this.prisma.$transaction(async (tx) => {
      const clients = await tx.client.updateMany({ where: { contactEmail: email }, data: { contactName: null, contactEmail: null } });
      const responses = await tx.customerResponse.findMany({ where: { signerEmail: email } });
      for (const r of responses) {
        await tx.customerResponse.update({ where: { id: r.id }, data: { signerName: 'Anonimizado', signerEmail: `anonimizado-${r.id.slice(-8)}@invalid`, comment: null, ipAddress: null, userAgent: null } });
      }
      for (const u of targetUsers) {
        await tx.user.update({
          where: { id: u.id },
          data: { displayName: 'Utilizador removido', email: `removido-${u.id.slice(-8)}@invalid`, isActive: false, passwordHash: null, rolesJson: [], tokenVersion: { increment: 1 } },
        });
      }
      await this.audit.record(tx, { actorUserId: actor.userId, entityType: 'privacy', entityId: actor.userId, action: 'privacy.anonymized', diff: { clients: clients.count, responses: responses.length, users: targetUsers.length } });
      return { clients: clients.count, customerResponses: responses.length, users: targetUsers.length };
    });
    for (const u of targetUsers) this.sessions.invalidate(u.id);
    return res;
  }
}
