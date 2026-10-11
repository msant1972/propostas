/** Leitura de CSV (RFC 4180): aspas, vírgulas e mudanças de linha dentro de campos, BOM, CRLF e delimitador `,` ou `;`. */

export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => {
    let n = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === c) n++;
    }
    return n;
  };
  const best = ([';', ',', '\t'] as const).map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ',';
}

/** Devolve as linhas como matrizes de texto; ignora linhas completamente vazias. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); if (row.some((c) => c.trim() !== '')) rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === d) endField();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else if (ch === '\n') endRow();
    else field += ch;
    i++;
  }
  if (quoted) throw new Error('CSV inválido: aspas por fechar');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Nome de coluna normalizado: minúsculas, sem acentos, espaços e hífenes para sublinhado. */
export const normalizeHeader = (h: string): string =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Número com vírgula ou ponto decimal; "1.234,56" → 1234.56. Devolve null se não for um número. */
export function parseDecimal(raw: string): string | null {
  let s = raw.trim().replace(/\s/g, '').replace(/^€|€$/g, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) {
    const decimal = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const thousand = decimal === ',' ? '.' : ',';
    s = s.split(thousand).join('').replace(decimal, '.');
  } else if (s.includes(',')) s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}
