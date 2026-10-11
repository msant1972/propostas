import { imageSize } from 'image-size';
import { HTMLElement, parse, TextNode } from 'node-html-parser';

// ---------------------------------------------------------------------------------------------
// Modelo de documento: independente do formato de saída (DOCX, PDF).
// ---------------------------------------------------------------------------------------------
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | { type: 'table'; rows: Run[][][] } // linhas → células → runs; a 1.ª linha é o cabeçalho
  | { type: 'image'; mime: 'image/png' | 'image/jpeg'; dataBase64: string; widthPx: number; heightPx: number; alt: string }
  | { type: 'pricing_table' }
  | { type: 'page_break' };

// ---------------------------------------------------------------------------------------------
// Sanitização do HTML do editor (antes de entrar no documento): lista de permissões estrita.
// ---------------------------------------------------------------------------------------------
const ALLOWED = new Set(['img', 'p', 'h1', 'h2', 'h3', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'span', 'div']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template']);
const VOID = new Set(['br', 'img']);

/** Imagens: só PNG/JPEG em base64 (o que o DOCX e o PDF aceitam), até 3 MB cada. Nada de URLs externas nem `file:`. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const DATA_IMG = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

export interface ParsedImage { mime: 'image/png' | 'image/jpeg'; dataBase64: string; widthPx: number; heightPx: number }

/** Valida o `src` de uma imagem: tipo, tamanho e conteúdo real (as dimensões vêm do próprio ficheiro, não do HTML). */
export function parseImageSrc(src: string): ParsedImage | null {
  const m = DATA_IMG.exec(src.trim());
  if (!m) return null;
  const dataBase64 = m[2]!;
  if (Math.floor((dataBase64.length * 3) / 4) > MAX_IMAGE_BYTES) return null;
  try {
    const bytes = Buffer.from(dataBase64, 'base64');
    const magicOk = m[1] === 'image/png' ? bytes.subarray(0, 4).toString('hex') === '89504e47' : bytes.subarray(0, 2).toString('hex') === 'ffd8';
    const { width, height } = imageSize(bytes);
    if (!magicOk || !width || !height || width > 20000 || height > 20000) return null;
    return { mime: m[1] as ParsedImage['mime'], dataBase64, widthPx: width, heightPx: height };
  } catch {
    return null;
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');
const safeHref = (h: string) => /^(https?:|mailto:)/i.test(h.trim());

function serialize(node: HTMLElement | TextNode): string {
  if (node instanceof TextNode) return esc(node.text);
  const tag = node.rawTagName?.toLowerCase();
  const inner = node.childNodes.map((c) => serialize(c as HTMLElement | TextNode)).join('');
  if (!tag) return inner; // raiz
  if (DROP_WITH_CONTENT.has(tag)) return '';
  if (!ALLOWED.has(tag)) return inner; // etiqueta desconhecida: mantém só o conteúdo
  if (tag === 'img') {
    const img = parseImageSrc(node.getAttribute('src') ?? '');
    if (!img) return ''; // imagem inválida, externa ou grande demais: removida
    const alt = escAttr((node.getAttribute('alt') ?? '').slice(0, 200));
    return `<img src="data:${img.mime};base64,${img.dataBase64}" alt="${alt}">`;
  }
  if (VOID.has(tag)) return `<${tag}>`;
  let attrs = '';
  if (tag === 'a') {
    const href = node.getAttribute('href');
    if (href && safeHref(href)) attrs = ` href="${escAttr(href.trim())}"`;
  }
  if (tag === 'td' || tag === 'th') {
    if (/^\d{1,2}$/.test(node.getAttribute('colspan') ?? '')) attrs += ` colspan="${node.getAttribute('colspan')}"`;
    if (/^\d{1,2}$/.test(node.getAttribute('rowspan') ?? '')) attrs += ` rowspan="${node.getAttribute('rowspan')}"`;
  }
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/** Remove scripts, estilos, atributos (exceto href seguro, colspan/rowspan e imagens PNG/JPEG em base64) e etiquetas fora da lista permitida. */
export function sanitizeHtml(html: string): string {
  return serialize(parse(html, { comment: false }));
}

// ---------------------------------------------------------------------------------------------
// HTML (já sanitizado) → blocos
// ---------------------------------------------------------------------------------------------
type Style = Pick<Run, 'bold' | 'italic' | 'underline'>;

function inlineRuns(node: HTMLElement | TextNode, style: Style = {}): Run[] {
  if (node instanceof TextNode) {
    const text = node.text.replace(/\s+/g, ' ');
    return text ? [{ text, ...style }] : [];
  }
  const tag = node.rawTagName?.toLowerCase();
  if (tag === 'br') return [{ text: '\n', ...style }];
  const next: Style = { ...style };
  if (tag === 'strong' || tag === 'b') next.bold = true;
  if (tag === 'em' || tag === 'i') next.italic = true;
  if (tag === 'u' || tag === 'a') next.underline = true;
  return node.childNodes.flatMap((c) => inlineRuns(c as HTMLElement | TextNode, next));
}

function trimRuns(runs: Run[]): Run[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length && out[0]!.text.trim() === '') out.shift();
  while (out.length && out[out.length - 1]!.text.trim() === '') out.pop();
  if (out.length) {
    out[0]!.text = out[0]!.text.replace(/^\s+/, '');
    out[out.length - 1]!.text = out[out.length - 1]!.text.replace(/\s+$/, '');
  }
  return out;
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'table', 'div', 'img']);

type ImageBlock = Extract<Block, { type: 'image' }>;
const imageBlock = (el: HTMLElement): ImageBlock | null => {
  const img = parseImageSrc(el.getAttribute('src') ?? '');
  return img ? { type: 'image', ...img, alt: el.getAttribute('alt') ?? '' } : null;
};

/** Texto e imagens de um parágrafo pela ordem em que aparecem: o texto fica em parágrafos, cada imagem num bloco próprio. */
function paragraphBlocks(el: HTMLElement): Block[] {
  const out: Block[] = [];
  let pending: Run[] = [];
  const flush = () => {
    const runs = trimRuns(pending);
    if (runs.length) out.push({ type: 'paragraph', runs });
    pending = [];
  };
  const walk = (node: HTMLElement | TextNode, style: Style) => {
    if (node instanceof TextNode) { pending.push(...inlineRuns(node, style)); return; }
    const tag = node.rawTagName?.toLowerCase();
    if (tag === 'img') { flush(); const b = imageBlock(node); if (b) out.push(b); return; }
    if (tag === 'br') { pending.push({ text: '\n', ...style }); return; }
    const next: Style = { ...style };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italic = true;
    if (tag === 'u' || tag === 'a') next.underline = true;
    node.childNodes.forEach((c) => walk(c as HTMLElement | TextNode, next));
  };
  walk(el, {});
  flush();
  return out;
}

function blocksOf(nodes: Array<HTMLElement | TextNode>): Block[] {
  const blocks: Block[] = [];
  let pending: Run[] = [];
  const flush = () => {
    const runs = trimRuns(pending);
    if (runs.length) blocks.push({ type: 'paragraph', runs });
    pending = [];
  };

  for (const node of nodes) {
    const tag = node instanceof TextNode ? undefined : node.rawTagName?.toLowerCase();
    if (!tag || !BLOCK_TAGS.has(tag)) {
      pending.push(...inlineRuns(node));
      continue;
    }
    flush();
    const el = node as HTMLElement;
    if (tag === 'img') {
      const b = imageBlock(el);
      if (b) blocks.push(b);
    } else if (tag === 'p') {
      blocks.push(...paragraphBlocks(el));
    } else if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const runs = trimRuns(inlineRuns(el));
      if (runs.length) blocks.push({ type: 'heading', level: Number(tag[1]) as 1 | 2 | 3, runs });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = el.childNodes
        .filter((c): c is HTMLElement => c instanceof HTMLElement && c.rawTagName?.toLowerCase() === 'li')
        .map((li) => trimRuns(inlineRuns(li)))
        .filter((r) => r.length);
      if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items });
    } else if (tag === 'table') {
      const rows = el.querySelectorAll('tr').map((tr) =>
        tr.childNodes
          .filter((c): c is HTMLElement => c instanceof HTMLElement && ['td', 'th'].includes(c.rawTagName?.toLowerCase()))
          .map((cell) => trimRuns(inlineRuns(cell))),
      );
      if (rows.length) blocks.push({ type: 'table', rows });
    } else {
      blocks.push(...blocksOf(el.childNodes as Array<HTMLElement | TextNode>)); // div: desembrulha
    }
  }
  flush();
  return blocks;
}

export function htmlToBlocks(html: string): Block[] {
  return blocksOf(parse(sanitizeHtml(html), { comment: false }).childNodes as Array<HTMLElement | TextNode>);
}

// ---------------------------------------------------------------------------------------------
// Merge tags: catálogo fechado e tipado
// ---------------------------------------------------------------------------------------------
export interface DocumentContext {
  client: { code: string; name: string; vatNumber: string | null; countryCode: string };
  proposal: { code: string; title: string; validUntil: string | null; currency: string; language: string };
  quote: {
    versionNumber: number;
    currency: string;
    totals: { subtotal: string; discountAmount: string; totalTax: string; grandTotal: string; mrr: string; tcv: string };
    lines: Array<{
      lineNumber: number;
      productName: string;
      quantity: string;
      termMonths: number | null;
      discountPercent: string;
      netUnitPrice: string;
      lineTotal: string;
    }>;
  };
  /** AAAA-MM-DD, fixado pelo chamador para a geração ser reproduzível. */
  today: string;
}

const fmtDate = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('/') : undefined);
const eur = (v: string, cur: string) => `${v} ${cur}`;

export const MERGE_TAGS: Record<string, { description: string; value: (c: DocumentContext) => string | undefined }> = {
  'cliente.nome': { description: 'Nome do cliente', value: (c) => c.client.name },
  'cliente.codigo': { description: 'Código do cliente', value: (c) => c.client.code },
  'cliente.nif': { description: 'NIF/VAT do cliente', value: (c) => c.client.vatNumber ?? undefined },
  'cliente.pais': { description: 'País do cliente', value: (c) => c.client.countryCode },
  'proposta.codigo': { description: 'Código da proposta', value: (c) => c.proposal.code },
  'proposta.titulo': { description: 'Título da proposta', value: (c) => c.proposal.title },
  'proposta.validade': { description: 'Data de validade', value: (c) => fmtDate(c.proposal.validUntil) },
  'proposta.moeda': { description: 'Moeda', value: (c) => c.proposal.currency },
  'cotacao.versao': { description: 'Número da versão da cotação', value: (c) => String(c.quote.versionNumber) },
  'cotacao.subtotal': { description: 'Subtotal', value: (c) => eur(c.quote.totals.subtotal, c.quote.currency) },
  'cotacao.desconto': { description: 'Desconto global', value: (c) => eur(c.quote.totals.discountAmount, c.quote.currency) },
  'cotacao.iva': { description: 'IVA total', value: (c) => eur(c.quote.totals.totalTax, c.quote.currency) },
  'cotacao.total': { description: 'Total', value: (c) => eur(c.quote.totals.grandTotal, c.quote.currency) },
  'cotacao.mrr': { description: 'Receita recorrente mensal', value: (c) => eur(c.quote.totals.mrr, c.quote.currency) },
  'cotacao.total_tcv': { description: 'Valor total do contrato', value: (c) => eur(c.quote.totals.tcv, c.quote.currency) },
  'data.hoje': { description: 'Data de hoje', value: (c) => fmtDate(c.today) },
};
/** Etiqueta estruturada: tem de estar sozinha num parágrafo e insere a tabela de preços. */
export const PRICING_TABLE_TAG = 'tabela_precos';

const TAG_RE = /\{\{\s*([a-z_]+(?:\.[a-z_]+)?)\s*\}\}/g;

export interface MergeIssue {
  tag: string;
  kind: 'UNKNOWN_TAG' | 'MISSING_VALUE' | 'TABLE_TAG_NOT_ALONE';
}

export function findMergeTags(text: string): string[] {
  return [...text.matchAll(TAG_RE)].map((m) => m[1]!);
}

/** Etiquetas que não pertencem ao catálogo fechado: validadas ao gravar a secção, sem precisar de contexto. */
export function unknownTags(text: string): string[] {
  return [...new Set(findMergeTags(text))].filter((t) => t !== PRICING_TABLE_TAG && !(t in MERGE_TAGS));
}

const plain = (runs: Run[]) => runs.map((r) => r.text).join('');

/** Substitui as etiquetas; devolve os problemas em vez de produzir texto vazio. */
export function applyMergeTags(blocks: Block[], ctx: DocumentContext): { blocks: Block[]; issues: MergeIssue[] } {
  const issues: MergeIssue[] = [];
  const sub = (runs: Run[]): Run[] =>
    runs.map((r) => ({
      ...r,
      text: r.text.replace(TAG_RE, (whole, tag: string) => {
        if (tag === PRICING_TABLE_TAG) {
          issues.push({ tag, kind: 'TABLE_TAG_NOT_ALONE' });
          return whole;
        }
        const def = MERGE_TAGS[tag];
        if (!def) {
          issues.push({ tag, kind: 'UNKNOWN_TAG' });
          return whole;
        }
        const v = def.value(ctx);
        if (v === undefined || v === '') {
          issues.push({ tag, kind: 'MISSING_VALUE' });
          return whole;
        }
        return v;
      }),
    }));

  const out: Block[] = [];
  for (const b of blocks) {
    if (b.type === 'paragraph' && /^\{\{\s*tabela_precos\s*\}\}$/.test(plain(b.runs).trim())) {
      out.push({ type: 'pricing_table' });
    } else if (b.type === 'paragraph' || b.type === 'heading') {
      out.push({ ...b, runs: sub(b.runs) });
    } else if (b.type === 'list') {
      out.push({ ...b, items: b.items.map(sub) });
    } else if (b.type === 'table') {
      out.push({ ...b, rows: b.rows.map((row) => row.map(sub)) });
    } else out.push(b);
  }
  return { blocks: out, issues };
}

export interface SectionInput {
  title: string;
  html: string;
}

/** Secções + contexto → blocos finais (cada secção abre com o seu título) e problemas de etiquetas. */
export function buildBlocks(sections: SectionInput[], ctx: DocumentContext): { blocks: Block[]; issues: MergeIssue[] } {
  const all: Block[] = [];
  for (const s of sections) {
    all.push({ type: 'heading', level: 1, runs: [{ text: s.title }] });
    all.push(...htmlToBlocks(s.html));
  }
  return applyMergeTags(all, ctx);
}
