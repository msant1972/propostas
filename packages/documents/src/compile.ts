import { uuidv7 } from '@cpq/shared';
import type { PrismaClient } from '@cpq/db';
import { buildBlocks, type DocumentContext, type MergeIssue, type SectionInput } from './content.js';
import { buildDocx } from './docx.js';
import { buildPdf } from './pdf.js';
import { safeSegment, type DocumentRepository, type StoredFile } from './repository.js';

export class CompileError extends Error {
  constructor(
    public readonly code: 'NO_QUOTE' | 'NO_SECTIONS' | 'MERGE_ISSUES',
    message: string,
    public readonly issues: MergeIssue[] = [],
  ) {
    super(message);
  }
}

export interface CompileInput {
  proposalId: string;
  requestedBy: string | null;
  /** Fixado pelo chamador (testes); por omissão, agora. */
  now?: Date;
}

export interface LoadedProposal {
  ctx: DocumentContext;
  sections: SectionInput[];
  clientCode: string;
  quoteVersionId: string;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const fixed = (d: { toFixed(n: number): string }, n = 2) => d.toFixed(n);

/** Lê da base de dados tudo o que um documento precisa: proposta, cliente, cotação corrente e secções por ordem. */
export async function loadProposal(prisma: PrismaClient, proposalId: string, now = new Date()): Promise<LoadedProposal> {
  const proposal = await prisma.proposal.findFirst({ where: { id: proposalId, deletedAt: null } });
  if (!proposal) throw new Error('Proposta não encontrada');
  const client = await prisma.client.findUniqueOrThrow({ where: { id: proposal.clientId } });
  const quote = await prisma.quoteVersion.findFirst({ where: { proposalId, isCurrent: true }, include: { items: { orderBy: { lineNumber: 'asc' } } } });
  if (!quote || quote.items.length === 0) throw new CompileError('NO_QUOTE', 'A proposta não tem uma cotação com linhas');

  const sections = await prisma.proposalSection.findMany({ where: { proposalId }, orderBy: { position: 'asc' }, include: { document: true } });
  if (sections.length === 0) throw new CompileError('NO_SECTIONS', 'A proposta não tem secções');

  const versionIds = sections.map((s) => s.blockVersionId).filter((x): x is string => !!x);
  const versions = await prisma.contentBlockVersion.findMany({ where: { id: { in: versionIds } } });
  const bodyOf = new Map(versions.map((v) => [v.id, v.bodyHtml]));

  return {
    clientCode: client.code,
    quoteVersionId: quote.id,
    sections: sections.map((s) => ({
      title: s.title,
      html: s.document?.htmlCache ?? (s.blockVersionId ? bodyOf.get(s.blockVersionId) : undefined) ?? '',
    })),
    ctx: {
      client: { code: client.code, name: client.name, vatNumber: client.vatNumber, countryCode: client.countryCode },
      proposal: { code: proposal.code, title: proposal.title, validUntil: day(proposal.validUntil), currency: proposal.currency, language: proposal.language },
      quote: {
        versionNumber: quote.versionNumber,
        currency: quote.currency,
        totals: {
          subtotal: fixed(quote.subtotal), discountAmount: fixed(quote.discountAmount), totalTax: fixed(quote.totalTax),
          grandTotal: fixed(quote.grandTotal), mrr: fixed(quote.totalMrr), tcv: fixed(quote.totalTcv),
        },
        lines: quote.items.map((i) => ({
          lineNumber: i.lineNumber, productName: i.productNameSnapshot, quantity: fixed(i.quantity, 3), termMonths: i.termMonths,
          discountPercent: fixed(i.discountPercent), netUnitPrice: fixed(i.netUnitPrice, 4), lineTotal: fixed(i.lineTotal),
        })),
      },
      today: day(now)!,
    },
  };
}

/** Valida sem gerar: devolve os problemas de etiquetas (usado pela API antes de aceitar o pedido). */
export async function validateProposal(prisma: PrismaClient, proposalId: string): Promise<void> {
  const { ctx, sections } = await loadProposal(prisma, proposalId);
  const { issues } = buildBlocks(sections, ctx);
  if (issues.length) throw new CompileError('MERGE_ISSUES', 'Há etiquetas por resolver', issues);
}

export interface CompiledDocuments {
  docx: { id: string } & StoredFile;
  pdf: { id: string } & StoredFile;
}

/** Gera DOCX e PDF, grava-os em 01_Trabalho e regista-os em `documents` (um ficheiro novo por geração). */
export async function compileProposal(prisma: PrismaClient, repo: DocumentRepository, input: CompileInput): Promise<CompiledDocuments> {
  const now = input.now ?? new Date();
  const { ctx, sections, clientCode, quoteVersionId } = await loadProposal(prisma, input.proposalId, now);
  const { blocks, issues } = buildBlocks(sections, ctx);
  if (issues.length) throw new CompileError('MERGE_ISSUES', 'Há etiquetas por resolver', issues);

  const [docxBytes, pdfBytes] = await Promise.all([buildDocx(blocks, ctx), buildPdf(blocks, ctx)]);
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const base = `${safeSegment(ctx.proposal.code)}_v${ctx.quote.versionNumber}_${stamp}_${uuidv7().slice(-6)}`;

  const save = async (kind: 'DOCX' | 'PDF', ext: string, bytes: Buffer) => {
    const fileName = `${base}.${ext}`;
    const stored = await repo.put({ clientCode, proposalCode: ctx.proposal.code, folder: '01_Trabalho', fileName, bytes });
    const id = uuidv7();
    await prisma.document.create({
      data: {
        id, proposalId: input.proposalId, quoteVersionId, kind, origin: 'GENERATED', folder: 'F01_TRABALHO', fileName,
        storageKey: stored.storageKey, sha256: stored.sha256, sizeBytes: stored.sizeBytes, createdBy: input.requestedBy,
      },
    });
    return { id, ...stored };
  };

  return { docx: await save('DOCX', 'docx', docxBytes), pdf: await save('PDF', 'pdf', pdfBytes) };
}

/**
 * Deteta edições manuais: se o ficheiro em disco já não tem o hash registado, passa a MANUALLY_EDITED.
 * (Substitui a subscrição Graph + delta query: o repositório é uma pasta local.)
 */
export async function detectManualEdits(prisma: PrismaClient, repo: DocumentRepository, proposalId?: string): Promise<string[]> {
  const docs = await prisma.document.findMany({
    where: { kind: { in: ['DOCX', 'PDF'] }, folder: 'F01_TRABALHO', origin: 'GENERATED', ...(proposalId ? { proposalId } : {}) },
  });
  const changed: string[] = [];
  for (const d of docs) {
    const now = await repo.currentHash(d.storageKey);
    if (now !== null && now !== d.sha256) {
      await prisma.document.update({ where: { id: d.id }, data: { origin: 'MANUALLY_EDITED' } });
      changed.push(d.id);
    }
  }
  return changed;
}
