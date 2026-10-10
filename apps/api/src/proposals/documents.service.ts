import { Inject, Injectable, NotFoundException, UnprocessableEntityException, ConflictException } from '@nestjs/common';
import { CompileError, validateProposal, type DocumentRepository } from '@cpq/documents';
import { uuidv7 } from '@cpq/shared';
import { OutboxService } from '../outbox/outbox.service.js';
import { PRISMA, type Prisma } from '../prisma/prisma.module.js';
import type { DocumentDto, JobStatusDto } from './sections.dto.js';

export const DOCUMENT_REPO = Symbol('DOCUMENT_REPO');

const FOLDER = { F01_TRABALHO: '01_Trabalho', F02_ENVIADO: '02_Enviado', F03_ASSINADO: '03_Assinado' } as const;
const MIME = { DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', PDF: 'application/pdf', SIGNED_PDF: 'application/pdf', ATTACHMENT: 'application/octet-stream' } as const;

type Row = Awaited<ReturnType<Prisma['document']['findFirstOrThrow']>>;
const toDto = (d: Row): DocumentDto => ({
  id: d.id, kind: d.kind, origin: d.origin, folder: FOLDER[d.folder], fileName: d.fileName, sha256: d.sha256,
  sizeBytes: Number(d.sizeBytes), quoteVersionId: d.quoteVersionId, createdAt: d.createdAt.toISOString(),
});

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: Prisma,
    @Inject(DOCUMENT_REPO) private readonly repo: DocumentRepository,
    private readonly outbox: OutboxService,
  ) {}

  /** Valida (etiquetas em falta bloqueiam) e pede a geração ao worker: a API nunca espera pelo ficheiro. */
  async requestCompile(proposal: { id: string; status: string }, actorUserId: string): Promise<{ eventId: string }> {
    if (!['DRAFT', 'IN_REVIEW'].includes(proposal.status)) throw new ConflictException('Só se geram documentos de propostas em rascunho ou em revisão');
    try {
      await validateProposal(this.prisma, proposal.id);
    } catch (e) {
      if (e instanceof CompileError) throw new UnprocessableEntityException({ message: e.message, code: e.code, issues: e.issues });
      throw e;
    }
    const eventId = await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, { aggregateId: proposal.id, eventType: 'document.compile', payload: { requestedBy: actorUserId } }),
    );
    return { eventId };
  }

  async jobStatus(proposalId: string, eventId: string): Promise<JobStatusDto> {
    const e = await this.prisma.outboxEvent.findFirst({ where: { id: eventId, aggregateId: proposalId, eventType: 'document.compile' } });
    if (!e) throw new NotFoundException('Pedido não encontrado');
    return { status: e.status, error: e.status === 'FAILED' || e.attempts > 0 ? e.lastError : null };
  }

  async list(proposalId: string): Promise<DocumentDto[]> {
    return (await this.prisma.document.findMany({ where: { proposalId }, orderBy: { createdAt: 'desc' } })).map(toDto);
  }

  async download(proposalId: string, documentId: string): Promise<{ bytes: Buffer; fileName: string; mime: string }> {
    const d = await this.prisma.document.findFirst({ where: { id: documentId, proposalId } });
    if (!d) throw new NotFoundException('Documento não encontrado');
    try {
      return { bytes: await this.repo.get(d.storageKey), fileName: d.fileName, mime: MIME[d.kind] };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundException('O ficheiro já não existe no repositório');
      throw e;
    }
  }

  /** Carrega uma versão editada à mão (Word/PDF). Fica registada como MANUALLY_EDITED, sem apagar a gerada. */
  async upload(proposal: { id: string; code: string; clientId: string }, actorUserId: string, kind: 'DOCX' | 'PDF', bytes: Buffer): Promise<DocumentDto> {
    const okDocx = bytes.subarray(0, 2).toString() === 'PK';
    const okPdf = bytes.subarray(0, 5).toString() === '%PDF-';
    if ((kind === 'DOCX' && !okDocx) || (kind === 'PDF' && !okPdf)) throw new UnprocessableEntityException('O ficheiro não corresponde ao tipo indicado');
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new UnprocessableEntityException('Ficheiro vazio ou superior a 25 MB');

    const client = await this.prisma.client.findUniqueOrThrow({ where: { id: proposal.clientId } });
    const origin = await this.prisma.document.findFirst({ where: { proposalId: proposal.id, kind }, orderBy: { createdAt: 'desc' } });
    const fileName = `${proposal.code}_editado_${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}_${uuidv7().slice(-6)}.${kind === 'DOCX' ? 'docx' : 'pdf'}`;
    const stored = await this.repo.put({ clientCode: client.code, proposalCode: proposal.code, folder: '01_Trabalho', fileName, bytes });
    const d = await this.prisma.document.create({
      data: {
        id: uuidv7(), proposalId: proposal.id, quoteVersionId: origin?.quoteVersionId, kind, origin: 'MANUALLY_EDITED', folder: 'F01_TRABALHO',
        fileName, storageKey: stored.storageKey, sha256: stored.sha256, sizeBytes: stored.sizeBytes, generatedFrom: origin?.id, createdBy: actorUserId,
      },
    });
    return toDto(d);
  }
}
