import PDFDocument from 'pdfkit';
import type { Block, DocumentContext, Run } from './content.js';
import { pricingRows } from './docx.js';

const COLOR = '#1F3A5F';
const GREY = '#B8C2D0';

const fontOf = (r: Run) => (r.bold && r.italic ? 'Helvetica-BoldOblique' : r.bold ? 'Helvetica-Bold' : r.italic ? 'Helvetica-Oblique' : 'Helvetica');

type Doc = InstanceType<typeof PDFDocument>;

function writeRuns(doc: Doc, runs: Run[], opts: { x?: number; y?: number; width: number; size?: number; align?: 'left' | 'right'; color?: string }): void {
  const size = opts.size ?? 11;
  runs.forEach((r, i) => {
    doc.font(fontOf(r)).fontSize(size).fillColor(opts.color ?? '#111111');
    const last = i === runs.length - 1;
    const o = { width: opts.width, continued: !last, underline: !!r.underline, align: opts.align ?? 'left', lineGap: 2 } as const;
    if (i === 0 && opts.x !== undefined) doc.text(r.text, opts.x, opts.y ?? doc.y, o);
    else doc.text(r.text, o);
  });
}

function table(doc: Doc, rows: Array<Array<{ runs: Run[]; span?: number; right?: boolean; bold?: boolean }>>, widths: number[], headerRows = 1): void {
  const left = doc.page.margins.left;
  const pad = 4;
  rows.forEach((row, ri) => {
    const cells = row.map((c, ci) => {
      const before = row.slice(0, ci).reduce((a, x) => a + (x.span ?? 1), 0);
      const span = c.span ?? 1;
      const w = widths.slice(before, before + span).reduce((a, b) => a + b, 0);
      const x = left + widths.slice(0, before).reduce((a, b) => a + b, 0);
      const text = c.runs.map((r) => r.text).join('');
      const bold = ri < headerRows || c.bold;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5);
      return { ...c, x, w, bold, text, h: doc.heightOfString(text || ' ', { width: w - pad * 2 }) + pad * 2 };
    });
    const h = Math.max(...cells.map((c) => c.h));
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    for (const c of cells) {
      if (ri < headerRows) doc.rect(c.x, y, c.w, h).fillAndStroke('#E7ECF3', GREY);
      else doc.rect(c.x, y, c.w, h).stroke(GREY);
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor('#111111');
      doc.text(c.text, c.x + pad, y + pad, { width: c.w - pad * 2, align: c.right ? 'right' : 'left' });
    }
    doc.x = left;
    doc.y = y + h;
  });
  doc.moveDown(0.8);
}

/**
 * PDF gerado diretamente do modelo de documento. É o conversor local (testes e desenvolvimento); em produção
 * o PDF vem da conversão do .docx pelo SharePoint (Microsoft Graph), que dá fidelidade total ao Word.
 */
export function buildPdf(blocks: Block[], ctx: DocumentContext): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 72, bottom: 72, left: 64, right: 64 }, bufferPages: true,
      info: { Title: ctx.proposal.title, Author: 'CPQ & Propostas', Subject: ctx.proposal.code },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    doc.font('Helvetica-Bold').fontSize(24).fillColor(COLOR).text(ctx.proposal.title, { width });
    doc.font('Helvetica').fontSize(12).fillColor('#444444').text(`${ctx.client.name} · ${ctx.proposal.code}`, { width });
    doc.moveDown(1.5);

    for (const b of blocks) {
      switch (b.type) {
        case 'heading': {
          const size = { 1: 18, 2: 14, 3: 12 }[b.level];
          if (doc.y > doc.page.height - doc.page.margins.bottom - 90) doc.addPage();
          doc.moveDown(0.6);
          writeRuns(doc, b.runs.map((r) => ({ ...r, bold: true })), { width, size, color: COLOR, x: left });
          doc.moveDown(0.4);
          break;
        }
        case 'paragraph':
          writeRuns(doc, b.runs, { width, x: left });
          doc.moveDown(0.6);
          break;
        case 'list':
          b.items.forEach((item, i) => {
            const y = doc.y;
            doc.font('Helvetica').fontSize(11).fillColor('#111111').text(b.ordered ? `${i + 1}.` : '•', left, y, { width: 18 });
            writeRuns(doc, item, { x: left + 18, y, width: width - 18 });
            doc.moveDown(0.2);
          });
          doc.moveDown(0.5);
          break;
        case 'table': {
          const cols = Math.max(...b.rows.map((r) => r.length));
          table(doc, b.rows.map((r) => Array.from({ length: cols }, (_, ci) => ({ runs: r[ci] ?? [] }))), Array(cols).fill(width / cols) as number[]);
          break;
        }
        case 'pricing_table': {
          const { header, rows, footer } = pricingRows(ctx);
          const w = [0.06, 0.34, 0.08, 0.12, 0.13, 0.09, 0.18].map((p) => p * width);
          const right = [false, false, true, false, true, true, true];
          const mk = (cells: string[]) => cells.map((v, i) => ({ runs: [{ text: v }], right: right[i] }));
          table(doc, [
            mk(header), ...rows.map(mk),
            ...footer.map(([label, value], i) => [{ runs: [{ text: label }], span: 6, right: true, bold: true }, { runs: [{ text: value }], right: true, bold: i === footer.length - 1 }]),
          ], w);
          break;
        }
        case 'page_break':
          doc.addPage();
          break;
      }
    }

    // Rodapé "Página X de Y": escreve-se no fim, página a página (sem margem inferior, para não abrir páginas novas).
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font('Helvetica').fontSize(9).fillColor('#666666')
        .text(`Página ${i + 1} de ${range.count}`, left, doc.page.height - 40, { width, align: 'center' })
        .text(ctx.proposal.code, left, 36, { width, align: 'right' });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
