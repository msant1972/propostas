import { XMLParser } from 'fast-xml-parser';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { applyMergeTags, buildBlocks, htmlToBlocks, sanitizeHtml, unknownTags, type DocumentContext } from './content.js';
import { buildDocx } from './docx.js';
import { buildPdf } from './pdf.js';

const ctx: DocumentContext = {
  client: { code: 'CLI-001', name: 'Cliente Exemplo, Lda.', vatNumber: '500000000', countryCode: 'PT' },
  proposal: { code: 'P-2026-0001', title: 'Proposta de Licenciamento', validUntil: '2026-12-31', currency: 'EUR', language: 'pt-PT' },
  quote: {
    versionNumber: 2, currency: 'EUR',
    totals: { subtotal: '981.00', discountAmount: '49.05', totalTax: '214.38', grandTotal: '1146.33', mrr: '81.75', tcv: '981.00' },
    lines: [
      { lineNumber: 1, productName: 'Licença Plataforma Core', quantity: '60.000', termMonths: 12, discountPercent: '10.00', netUnitPrice: '16.2000', lineTotal: '923.40' },
      { lineNumber: 2, productName: 'Suporte Premium', quantity: '1.000', termMonths: 12, discountPercent: '0.00', netUnitPrice: '9.0000', lineTotal: '9.00' },
    ],
  },
  today: '2026-10-11',
};

describe('sanitizeHtml', () => {
  it('remove scripts, eventos e estilos', () => {
    const out = sanitizeHtml('<p onclick="x()">Olá<script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)></p>');
    expect(out).toBe('<p>Olá</p>');
  });
  it('só aceita ligações http, https e mailto', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizeHtml('<a href="https://exemplo.pt" target="_blank">x</a>')).toBe('<a href="https://exemplo.pt">x</a>');
  });
  it('escapa texto e mantém a formatação permitida', () => {
    expect(sanitizeHtml('<p>a &lt; b <strong>forte</strong></p>')).toBe('<p>a &lt; b <strong>forte</strong></p>');
  });
});

describe('htmlToBlocks', () => {
  it('converte títulos, parágrafos formatados, listas e tabelas', () => {
    const blocks = htmlToBlocks('<h2>Âmbito</h2><p>Texto <strong>forte</strong> e <em>itálico</em>.</p><ul><li>um</li><li>dois</li></ul><ol><li>a</li></ol><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'list', 'list', 'table']);
    const p = blocks[1]!;
    expect(p.type === 'paragraph' && p.runs.map((r) => [r.text, !!r.bold, !!r.italic])).toEqual([['Texto ', false, false], ['forte', true, false], [' e ', false, false], ['itálico', false, true], ['.', false, false]]);
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: 'um' }], [{ text: 'dois' }]] });
    expect(blocks[4]).toMatchObject({ rows: [[[{ text: 'A' }], [{ text: 'B' }]], [[{ text: '1' }], [{ text: '2' }]]] });
  });
  it('texto solto vira parágrafo e divs são desembrulhadas', () => {
    expect(htmlToBlocks('solto<div><p>dentro</p></div>').map((b) => b.type)).toEqual(['paragraph', 'paragraph']);
  });
});

describe('merge tags', () => {
  it('substitui as etiquetas do catálogo', () => {
    const { blocks, issues } = applyMergeTags(htmlToBlocks('<p>{{cliente.nome}} — total {{cotacao.total}} até {{proposta.validade}}</p>'), ctx);
    expect(issues).toEqual([]);
    expect(blocks[0]).toMatchObject({ runs: [{ text: 'Cliente Exemplo, Lda. — total 1146.33 EUR até 31/12/2026' }] });
  });
  it('uma etiqueta em falta bloqueia em vez de produzir texto vazio', () => {
    const noVat = { ...ctx, client: { ...ctx.client, vatNumber: null } };
    const { issues } = applyMergeTags(htmlToBlocks('<p>NIF {{cliente.nif}}</p>'), noVat);
    expect(issues).toEqual([{ tag: 'cliente.nif', kind: 'MISSING_VALUE' }]);
  });
  it('etiquetas fora do catálogo são recusadas', () => {
    expect(applyMergeTags(htmlToBlocks('<p>{{cliente.segredo}}</p>'), ctx).issues).toEqual([{ tag: 'cliente.segredo', kind: 'UNKNOWN_TAG' }]);
    expect(unknownTags('{{cliente.nome}} {{x.y}} {{tabela_precos}}')).toEqual(['x.y']);
  });
  it('a tabela de preços tem de estar sozinha no parágrafo', () => {
    expect(applyMergeTags(htmlToBlocks('<p>{{tabela_precos}}</p>'), ctx).blocks).toEqual([{ type: 'pricing_table' }]);
    expect(applyMergeTags(htmlToBlocks('<p>ver {{tabela_precos}}</p>'), ctx).issues).toEqual([{ tag: 'tabela_precos', kind: 'TABLE_TAG_NOT_ALONE' }]);
  });
});

const sections = [
  { title: 'Âmbito', html: '<p>Proposta para <strong>{{cliente.nome}}</strong>.</p><ul><li>Licenças</li><li>Suporte</li></ul><ol><li>Passo 1</li></ol><ol><li>Outra lista</li></ol>' },
  { title: 'Preços', html: '<p>{{tabela_precos}}</p><p>Válida até {{proposta.validade}}. Total: {{cotacao.total}}.</p>' },
];

describe('buildDocx', () => {
  it('gera um .docx válido com o conteúdo, a tabela de preços e a numeração', async () => {
    const { blocks, issues } = buildBlocks(sections, ctx);
    expect(issues).toEqual([]);
    const buf = await buildDocx(blocks, ctx);
    expect(buf.subarray(0, 2).toString()).toBe('PK'); // zip

    const zip = new PizZip(buf);
    const xml = zip.file('word/document.xml')!.asText();
    new XMLParser({ ignoreAttributes: false }).parse(xml); // lança se o XML estiver mal formado
    for (const text of ['Proposta de Licenciamento', 'Cliente Exemplo, Lda.', 'P-2026-0001', 'Âmbito', 'Licença Plataforma Core', '923.40', '1146.33', '31/12/2026']) {
      expect(xml, text).toContain(text);
    }
    expect(xml).not.toContain('{@conteudo}');
    expect(xml).not.toContain('{{');
    // duas listas numeradas, cada uma com a sua instância (recomeça em 1)
    expect(xml).toContain('w:numId w:val="100"');
    expect(xml).toContain('w:numId w:val="101"');
    const numbering = zip.file('word/numbering.xml')!.asText();
    new XMLParser().parse(numbering);
    expect(numbering).toContain('w:numId="101"');
    expect(zip.file('word/header1.xml')!.asText()).toContain('P-2026-0001');
  });

  it('o texto do utilizador é escapado (não injeta XML)', async () => {
    const { blocks } = buildBlocks([{ title: 'X', html: '<p>a &lt;w:p&gt; &amp; b</p>' }], ctx);
    const xml = new PizZip(await buildDocx(blocks, ctx)).file('word/document.xml')!.asText();
    new XMLParser().parse(xml);
    expect(xml).toContain('a &lt;w:p&gt; &amp; b');
  });
});

describe('buildPdf', () => {
  it('gera um PDF com as páginas e o rodapé', async () => {
    const { blocks } = buildBlocks(sections, ctx);
    const pdf = await buildPdf(blocks, ctx);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
    expect(pdf.toString('latin1')).toMatch(/\/Type \/Page\b/);
  });
  it('documentos longos fazem várias páginas', async () => {
    const long = Array.from({ length: 80 }, (_, i) => `<p>Parágrafo ${i} com texto suficiente para ocupar espaço na página do documento gerado.</p>`).join('');
    const { blocks } = buildBlocks([{ title: 'Longo', html: long }], ctx);
    const pdf = await buildPdf(blocks, ctx);
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });
});
