import { Global, Injectable, Module } from '@nestjs/common';
import { AUDIT_EVENT, auditPayload, type PrismaClient } from '@cpq/db';
import { OutboxService } from '../outbox/outbox.service.js';

type Tx = Pick<PrismaClient, 'outboxEvent'>;

export interface AuditInput {
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  diff?: Record<string, unknown>;
}

/**
 * Regista um facto na cadeia de auditoria: grava um evento `audit.record` no outbox, na MESMA transação da
 * alteração de negócio. A fila `audit` do worker (concorrência 1) acrescenta-o depois à cadeia de hashes.
 */
@Injectable()
export class AuditService {
  constructor(private readonly outbox: OutboxService) {}

  record(tx: Tx, a: AuditInput): Promise<string> {
    const entry = auditPayload({ actorUserId: a.actorUserId, entityType: a.entityType, entityId: a.entityId, action: a.action, diff: a.diff ?? {} });
    return this.outbox.enqueue(tx, { aggregateId: a.entityId, eventType: AUDIT_EVENT, payload: entry as never });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
