import {
  AlignmentType, Document, Footer, Header, HeadingLevel, LevelFormat, Packer, PageNumber, Paragraph, TextRun,
} from 'docx';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { Block, DocumentContext, Run } from './content.js';

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------------
// Modelo base (.docx): estilos, cabeçalho/rodapé e o marcador {@conteudo}, onde o Docxtemplater
// insere o corpo. Em produção pode ser substituído por um modelo da empresa guardado no SharePoint.
// ---------------------------------------------------------------------------------------------
let baseTemplate: Promise<Buffer> | undefined;

export function createBaseTemplate(): Promise<Buffer> {
  const font = 'Calibri';
  const heading = (id: string, size: number, before: number) => ({
    id, name: id, basedOn: 'Normal', next: 'Normal', quickFormat: true,
    run: { font, size, bold: true, color: '1F3A5F' },
    paragraph: { spacing: { before, after: 120 }, keepNext: true },
  });
  const doc = new Document({
    creator: 'CPQ & Propostas',
    styles: {
      default: { document: { run: { font, size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        heading('Heading1', 32, 360), heading('Heading2', 26, 240), heading('Heading3', 23, 200),
        { id: 'ListParagraph', name: 'List Paragraph', basedOn: 'Normal', quickFormat: true, paragraph: { spacing: { after: 60 } } },
      ],
    },
    numbering: {
      config: [
        { reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT }] },
        { reference: 'n', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT }] },
      ],
    },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: '{codigo}', color: '666666', size: 18 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], color: '666666', size: 18 })] })] }) },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: '{titulo}', bold: true, size: 48, color: '1F3A5F' })] }),
        new Paragraph({ children: [new TextRun({ text: '{cliente} · {codigo}', color: '444444', size: 24 })], spacing: { after: 360 } }),
        new Paragraph({ children: [new TextRun('{@conteudo}')] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

// Numeração própria: 1 = marcas; 100+k = k-ésima lista numerada (cada uma recomeça em 1).
function numberingXml(orderedLists: number): string {
  const lvl = (fmt: string, text: string) =>
    `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  const nums = Array.from({ length: orderedLists }, (_, k) =>
    `<w:num w:numId="${100 + k}"><w:abstractNumId w:val="2"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${lvl('bullet', '•')}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/>${lvl('decimal', '%1.')}</w:abstractNum>` +
    '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' + nums + '</w:numbering>'
  );
}

// ---------------------------------------------------------------------------------------------
// Blocos → WordprocessingML
// ---------------------------------------------------------------------------------------------
function runXml(r: Run, extra = ''): string {
  const props = `${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}${r.underline ? '<w:u w:val="single"/>' : ''}${extra}`;
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  return r.text
    .split('\n')
    .map((part, i) => `${i > 0 ? `<w:r>${rPr}<w:br/></w:r>` : ''}${part ? `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(part)}</w:t></w:r>` : ''}`)
    .join('');
}

const para = (runs: Run[], pPr = '', extra = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${runs.map((r) => runXml(r, extra)).join('')}</w:p>`;

const BORDERS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="B8C2D0"/>`).join('');

interface Cell { runs: Run[]; width: number; header?: boolean; right?: boolean; span?: number; bold?: boolean }

function tableXml(rows: Cell[][], widths: number[]): string {
  const grid = widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
  const body = rows
    .map((row, ri) => {
      const cells = row
        .map((c) => {
          const tcPr = `<w:tcW w:w="${c.width}" w:type="dxa"/>${c.span ? `<w:gridSpan w:val="${c.span}"/>` : ''}${c.header ? '<w:shd w:val="clear" w:color="auto" w:fill="E7ECF3"/>' : ''}`;
          const runs = c.runs.length ? c.runs.map((r) => ({ ...r, bold: r.bold || c.header || c.bold })) : [];
          const p = runs.length ? para(runs, c.right ? '<w:jc w:val="right"/>' : '') : '<w:p/>';
          return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${p}</w:tc>`;
        })
        .join('');
      return `<w:tr>${ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells}</w:tr>`;
    })
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${BORDERS}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl><w:p/>`;
}

const t = (text: string): Run[] => [{ text }];

export function pricingRows(ctx: DocumentContext): { header: string[]; rows: string[][]; footer: Array<[string, string]> } {
  const q = ctx.quote;
  return {
    header: ['#', 'Produto', 'Qtd.', 'Duração', 'Preço unit.', 'Desc. %', `Total (${q.currency})`],
    rows: q.lines.map((l) => [
      String(l.lineNumber), l.productName, l.quantity.replace(/\.?0+$/, '') || '0',
      l.termMonths ? `${l.termMonths} meses` : '—', l.netUnitPrice, l.discountPercent, l.lineTotal,
    ]),
    footer: [
      ['Subtotal', q.totals.subtotal], ['Desconto', `−${q.totals.discountAmount}`],
      ['IVA', q.totals.totalTax], ['Total', q.totals.grandTotal],
    ],
  };
}

function pricingXml(ctx: DocumentContext): string {
  const { header, rows, footer } = pricingRows(ctx);
  const widths = [500, 3300, 800, 1100, 1200, 800, 1300]; // 9000 twips
  const right = [false, false, true, false, true, true, true];
  const head: Cell[] = header.map((h, i) => ({ runs: t(h), width: widths[i]!, header: true, right: right[i] }));
  const body: Cell[][] = rows.map((r) => r.map((v, i) => ({ runs: t(v), width: widths[i]!, right: right[i] })));
  const foot: Cell[][] = footer.map(([label, value], i) => [
    { runs: t(label), width: 7700, span: 6, right: true, bold: true },
    { runs: t(value), width: 1300, right: true, bold: i === footer.length - 1 },
  ]);
  return tableXml([head, ...body, ...foot], widths);
}

export function blocksToXml(blocks: Block[], ctx: DocumentContext): string {
  let ordered = 0;
  return blocks
    .map((b) => {
      switch (b.type) {
        case 'heading': return para(b.runs, `<w:pStyle w:val="Heading${b.level}"/>`);
        case 'paragraph': return para(b.runs);
        case 'list': {
          const numId = b.ordered ? 100 + ordered++ : 1;
          return b.items.map((it) => para(it, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`)).join('');
        }
        case 'table': {
          const cols = Math.max(...b.rows.map((r) => r.length));
          const w = Math.floor(9000 / cols);
          return tableXml(b.rows.map((r, ri) => Array.from({ length: cols }, (_, ci) => ({ runs: r[ci] ?? [], width: w, header: ri === 0 }))), Array(cols).fill(w) as number[]);
        }
        case 'pricing_table': return pricingXml(ctx);
        case 'page_break': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      }
    })
    .join('');
}

/** Gera o .docx: modelo base + Docxtemplater (`{@conteudo}` recebe o corpo em WordprocessingML). */
export async function buildDocx(blocks: Block[], ctx: DocumentContext): Promise<Buffer> {
  baseTemplate ??= createBaseTemplate();
  const doc = new Docxtemplater(new PizZip(await baseTemplate), { paragraphLoop: true, linebreaks: false });
  doc.render({ titulo: ctx.proposal.title, cliente: ctx.client.name, codigo: ctx.proposal.code, conteudo: blocksToXml(blocks, ctx) });

  const zip = doc.getZip();
  const orderedLists = blocks.filter((b) => b.type === 'list' && b.ordered).length;
  zip.file('word/numbering.xml', numberingXml(orderedLists));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
