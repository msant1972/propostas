import { Injectable } from '@nestjs/common';
import { uuidv7 } from '@cpq/shared';
import type { Prisma } from '@cpq/db';

export interface OutboxInput {
  aggregateId: string;
  eventType: string;
  payload: Prisma.InputJsonObject;
}

/** Cliente transacional (o `tx` de `prisma.$transaction`) ou o cliente normal. */
type Tx = Pick<import('@cpq/db').PrismaClient, 'outboxEvent'>;

@Injectable()
export class OutboxService {
  /** Grava o evento na MESMA transação da alteração de negócio; o relay do worker publica-o depois. */
  async enqueue(tx: Tx, input: OutboxInput): Promise<string> {
    const id = uuidv7();
    await tx.outboxEvent.create({
      data: { id, aggregateId: input.aggregateId, eventType: input.eventType, payload: input.payload },
    });
    return id;
  }
}
