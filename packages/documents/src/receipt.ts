import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import PDFDocument from 'pdfkit';

export interface ReceiptData {
  proposalCode: string;
  proposalTitle: string;
  clientName: string;
  decision: 'ACCEPTED' | 'DECLINED';
  signerName: string;
  signerEmail: string;
  comment: string | null;
  decidedAt: string; // ISO 8601 UTC
  ipAddress: string | null;
  userAgent: string | null;
  documentFileName: string;
  documentSha256: string;
  quoteSnapshotHash: string | null;
}

/**
 * Comprovativo de aceitação (ou recusa) pelo cliente. É a prova da assinatura eletrónica simples:
 * identifica a proposta e o documento exato (pelo hash), quem respondeu, quando e de onde.
 */
export function buildReceiptPdf(d: ReceiptData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 72, bottom: 72, left: 64, right: 64 }, info: { Title: `Comprovativo ${d.proposalCode}`, Subject: d.proposalCode, Author: 'CPQ & Propostas' } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accepted = d.decision === 'ACCEPTED';
    const width = doc.page.width - 128;
    doc.font('Helvetica-Bold').fontSize(22).fillColor('#1F3A5F').text(accepted ? 'Comprovativo de aceitação' : 'Comprovativo de recusa', { width });
    doc.moveDown(0.3).font('Helvetica').fontSize(12).fillColor('#444444').text(`Proposta ${d.proposalCode} — ${d.proposalTitle}`, { width });
    doc.moveDown(1.2);

    const row = (label: string, value: string, mono = false) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#444444').text(label, { width });
      doc.font(mono ? 'Courier' : 'Helvetica').fontSize(mono ? 9 : 11).fillColor('#111111').text(value || '—', { width });
      doc.moveDown(0.6);
    };

    doc.font('Helvetica').fontSize(11).fillColor('#111111').text(
      accepted
        ? `${d.signerName} (${d.signerEmail}), em representação de ${d.clientName}, declarou ter lido e aceitar a proposta acima referida, no documento identificado pelo hash abaixo.`
        : `${d.signerName} (${d.signerEmail}), em representação de ${d.clientName}, declarou recusar a proposta acima referida.`,
      { width },
    );
    doc.moveDown(1);
    row('Decisão', accepted ? 'ACEITE' : 'RECUSADA');
    row('Signatário', `${d.signerName} <${d.signerEmail}>`);
    row('Cliente', d.clientName);
    row('Data e hora (UTC)', d.decidedAt.replace('T', ' ').replace(/\.\d+Z$/, 'Z'));
    row('Endereço IP', d.ipAddress ?? 'não registado');
    row('Agente de utilizador', d.userAgent ?? 'não registado');
    if (d.comment) row('Comentário', d.comment);
    row('Documento', d.documentFileName);
    row('SHA-256 do documento', d.documentSha256, true);
    if (d.quoteSnapshotHash) row('SHA-256 da cotação (snapshot)', d.quoteSnapshotHash, true);

    doc.moveDown(1).font('Helvetica-Oblique').fontSize(9).fillColor('#666666').text(
      'Assinatura eletrónica simples: a prova é o conjunto destes dados, registado pelo sistema no momento da resposta e guardado na auditoria encadeada por hashes.',
      { width },
    );
    doc.end();
  });
}

/** Impressão digital SHA-256 do certificado (formato `AA:BB:…`), ou null se o ficheiro não existir ou não for válido. */
export function certificateFingerprint(file: string | undefined): string | null {
  if (!file) return null;
  try {
    return new X509Certificate(readFileSync(file)).fingerprint256;
  } catch {
    return null;
  }
}
