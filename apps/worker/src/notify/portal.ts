import { createHash } from 'node:crypto';
import { buildReceiptPdf, certificateFingerprint, type DocumentRepository } from '@cpq/documents';
import type { PrismaClient } from '@cpq/db';
import { uuidv7 } from '@cpq/shared';
import { AUDIT_EVENT, auditPayload } from '@cpq/db';
import type { WorkerConfig } from '../config.js';
import type { Notifier } from './notifier.js';

interface Ctx {
  prisma: PrismaClient;
  repo: DocumentRepository;
  notifier: Notifier;
  cfg: WorkerConfig;
}

/** Envia ao cliente a ligação do portal (com a impressão digital do certificado, para ele poder confirmá-lo). */
export async function sendInvite({ prisma, notifier, cfg }: Ctx, proposalId: string, payload: Record<string, unknown>): Promise<void> {
  const link = await prisma.shareLink.findUniqueOrThrow({ where: { id: String(payload['linkId']) } });
  if (link.revokedAt || link.expiresAt.getTime() <= Date.now()) return; // entretanto revogada ou expirada: não se envia
  const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } });
  const client = await prisma.client.findUniqueOrThrow({ where: { id: p.clientId } });
  const url = `${cfg.APP_BASE_URL.replace(/\/$/, '')}/portal/${String(payload['token'])}`;
  const fp = certificateFingerprint(cfg.TLS_CERT_FILE);
  await notifier.send({
    to: [{ name: client.contactName ?? client.name, email: String(payload['to']) }],
    subject: `Proposta ${p.code}: ${p.title}`,
    text:
      `Bom dia,\n\nEnviamos a proposta "${p.title}" (${p.code}). Pode consultá-la e responder através da ligação seguinte, válida até ${link.expiresAt.toISOString().slice(0, 10)}.\n\n${url}` +
      (fp ? `\n\nO nosso servidor usa um certificado próprio, por isso o browser pode mostrar um aviso na primeira visita. Para confirmar que está no servidor certo, a impressão digital SHA-256 do certificado é:\n${fp}` : ''),
  });
}

/** Gera o comprovativo da resposta do cliente e guarda-o em 03_Assinado (uma só vez, mesmo que o job se repita). */
export async function makeReceipt({ prisma, repo }: Ctx, proposalId: string, payload: Record<string, unknown>): Promise<void> {
  const r = await prisma.customerResponse.findUniqueOrThrow({ where: { id: String(payload['responseId']) } });
  const [p, link] = await Promise.all([prisma.proposal.findUniqueOrThrow({ where: { id: proposalId } }), prisma.shareLink.findUniqueOrThrow({ where: { id: r.shareLinkId } })]);
  const [client, doc] = await Promise.all([prisma.client.findUniqueOrThrow({ where: { id: p.clientId } }), prisma.document.findUniqueOrThrow({ where: { id: link.documentId } })]);
  const version = doc.quoteVersionId ? await prisma.quoteVersion.findUnique({ where: { id: doc.quoteVersionId } }) : null;

  const fileName = `${p.code}_comprovativo_${r.decision === 'ACCEPTED' ? 'aceitacao' : 'recusa'}_${r.id.slice(-8)}.pdf`;
  if (await prisma.document.findFirst({ where: { proposalId, fileName, folder: 'F03_ASSINADO' } })) return;

  const bytes = await buildReceiptPdf({
    proposalCode: p.code, proposalTitle: p.title, clientName: client.name, decision: r.decision, signerName: r.signerName, signerEmail: r.signerEmail,
    comment: r.comment, decidedAt: r.decidedAt.toISOString(), ipAddress: r.ipAddress, userAgent: r.userAgent, documentFileName: doc.fileName,
    documentSha256: r.documentSha256, quoteSnapshotHash: version?.snapshotHash ?? null,
  });
  const stored = await repo.put({ clientCode: client.code, proposalCode: p.code, folder: '03_Assinado', fileName, bytes });
  await prisma.$transaction(async (tx) => {
    const id = uuidv7();
    await tx.document.create({
      data: { id, proposalId, quoteVersionId: doc.quoteVersionId, kind: 'SIGNED_PDF', origin: 'GENERATED', folder: 'F03_ASSINADO', fileName, storageKey: stored.storageKey, sha256: stored.sha256, sizeBytes: stored.sizeBytes, generatedFrom: doc.id },
    });
    await tx.outboxEvent.create({
      data: { id: uuidv7(), aggregateId: proposalId, eventType: AUDIT_EVENT, payload: auditPayload({ actorUserId: null, entityType: 'proposal', entityId: proposalId, action: 'portal.receipt_generated', diff: { documentId: id, sha256: stored.sha256, responseId: r.id } }) as never },
    });
  });
}

export const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
