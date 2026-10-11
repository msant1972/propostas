import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma, type PrismaClient } from '../src/index.js';
import { importCsv } from '../src/import/import.js';
import { detectDelimiter, normalizeHeader, parseCsv, parseDecimal } from '../src/import/csv.js';
import { migrate } from '../src/migrate.js';
import { testDatabase } from '../src/testing.js';

describe('leitura de CSV', () => {
  it('trata aspas, vírgulas e mudanças de linha dentro de campos', () => {
    const rows = parseCsv('a,b,c\r\n1,"dois, com vírgula","linha\nseguinte"\r\n"aspas ""duplas""",,x\r\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['1', 'dois, com vírgula', 'linha\nseguinte'], ['aspas "duplas"', '', 'x']]);
  });
  it('remove o BOM, ignora linhas vazias e deteta o delimitador', () => {
    expect(parseCsv('﻿a;b\n\n1;2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(detectDelimiter('nome;pais\nx;PT')).toBe(';');
    expect(detectDelimiter('nome,pais\nx,PT')).toBe(',');
    expect(detectDelimiter('"a;b",c\n1,2')).toBe(',');
  });
  it('recusa aspas por fechar', () => {
    expect(() => parseCsv('a,b\n"x,y')).toThrow(/aspas/);
  });
  it('normaliza cabeçalhos e números pt-PT', () => {
    expect(normalizeHeader('  Modelo de Cobrança ')).toBe('modelo_de_cobranca');
    expect(parseDecimal('1.234,56')).toBe('1234.56');
    expect(parseDecimal('12,5')).toBe('12.5');
    expect(parseDecimal('12.5')).toBe('12.5');
    expect(parseDecimal('1,234.56')).toBe('1234.56');
    expect(parseDecimal('€ 9,90')).toBe('9.90');
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('')).toBeNull();
  });
});

const base = process.env['TEST_DATABASE_URL'];
const run = describe.skipIf(!base);

run('importação para a base de dados', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    const url = await testDatabase(base!, 'import');
    await migrate(url, 'up');
    prisma = createPrisma(url);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of ['price_list_items', 'price_lists', 'products', 'clients']) await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    });
  });
  afterAll(() => prisma?.$disconnect());

  const clients = 'codigo;nome;nif;pais;contacto_email\nC1;Alfa, Lda.;501;pt;Alfa@Alfa.pt\nC2;"Beta ""Norte"" SA";502;ES;\n';

  it('clientes: simulação não grava; gravar cria; repetir não duplica', async () => {
    const dry = await importCsv(prisma, { type: 'clients', csv: clients, dryRun: true });
    expect(dry).toMatchObject({ created: 2, updated: 0, unchanged: 0, applied: false, errors: [] });
    expect(await prisma.client.count()).toBe(0);

    const real = await importCsv(prisma, { type: 'clients', csv: clients });
    expect(real).toMatchObject({ created: 2, applied: true });
    expect(await prisma.client.findUniqueOrThrow({ where: { code: 'C1' } })).toMatchObject({ countryCode: 'PT', contactEmail: 'alfa@alfa.pt' });
    expect((await prisma.client.findUniqueOrThrow({ where: { code: 'C2' } })).name).toBe('Beta "Norte" SA');

    const again = await importCsv(prisma, { type: 'clients', csv: clients });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    const changed = await importCsv(prisma, { type: 'clients', csv: clients.replace('Alfa, Lda.', 'Alfa Nova, Lda.') });
    expect(changed).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    expect(await prisma.client.count()).toBe(2);
  });

  it('cabeçalhos em inglês ou português dão o mesmo resultado', async () => {
    const r = await importCsv(prisma, { type: 'clients', csv: 'code,name,country\nC3,Gama,DE\n' });
    expect(r).toMatchObject({ created: 1, errors: [] });
  });

  it('um erro cancela tudo (atomicidade) e é reportado com linha e coluna', async () => {
    const before = await prisma.client.count();
    const bad = 'codigo;nome;pais;contacto_email\nC4;Delta;PT;nao-e-email\nC5;;PORTUGAL;\nC6;Ok;PT;\nC6;Repetido;PT;\n';
    const r = await importCsv(prisma, { type: 'clients', csv: bad });
    expect(r.applied).toBe(false);
    expect(r.errors.map((e) => `${e.line}:${e.column}`)).toEqual(['2:contactEmail', '3:name', '3:countryCode', '5:code']);
    expect(await prisma.client.count()).toBe(before);
  });

  it('--skip-invalid grava as linhas válidas e ignora as outras', async () => {
    const r = await importCsv(prisma, { type: 'clients', csv: 'codigo;nome;pais\nC7;Bom;PT\nC8;;PT\n', skipInvalid: true });
    expect(r).toMatchObject({ created: 1, skipped: 1, applied: true });
    expect(await prisma.client.findUnique({ where: { code: 'C7' } })).not.toBeNull();
    expect(await prisma.client.findUnique({ where: { code: 'C8' } })).toBeNull();
  });

  it('falta de colunas obrigatórias é reportada no cabeçalho', async () => {
    const r = await importCsv(prisma, { type: 'clients', csv: 'nome;pais\nX;PT\n' });
    expect(r.errors).toEqual([{ line: 1, column: 'code', message: expect.stringContaining('obrigatória') }]);
    expect((await importCsv(prisma, { type: 'clients', csv: '' })).errors[0]!.message).toMatch(/vazio/);
  });

  const products = [
    'sku;nome;modelo_cobranca;periodo;custo;categoria_fiscal;ativo',
    'LIC-1;Licença mensal;RECORRENTE;MES;"1.234,50";STANDARD;sim',
    'IMP-1;Implementação;PONTUAL;;40;REDUCED;',
    'CON-1;Consumo;USAGE_BASED;;0,40;;não',
  ].join('\n');

  it('produtos: modelos e períodos em português, custos com vírgula e ativo/inativo', async () => {
    const r = await importCsv(prisma, { type: 'products', csv: products });
    expect(r).toMatchObject({ created: 3, applied: true, errors: [] });
    expect(await prisma.product.findUniqueOrThrow({ where: { sku: 'LIC-1' } })).toMatchObject({ billingModel: 'RECURRING', billingPeriod: 'MONTH', isActive: true });
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'LIC-1' } })).unitCost.toFixed(2)).toBe('1234.50');
    expect(await prisma.product.findUniqueOrThrow({ where: { sku: 'CON-1' } })).toMatchObject({ isActive: false, taxCategory: 'STANDARD' });
    expect(await importCsv(prisma, { type: 'products', csv: products })).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
  });

  it('produtos: recorrente sem período, modelo ou fiscal inválido e SKU repetido são recusados', async () => {
    const r = await importCsv(prisma, { type: 'products', csv: 'sku;nome;modelo_cobranca;periodo;categoria_fiscal\nA;A;RECORRENTE;;STANDARD\nB;B;XPTO;;STANDARD\nC;C;PONTUAL;;LUXO\nC;C2;PONTUAL;;STANDARD\n' });
    expect(r.errors.map((e) => `${e.line}:${e.column}`)).toEqual(['2:billingPeriod', '3:billingModel', '4:taxCategory', '5:sku']);
    expect(await prisma.product.count()).toBe(3);
  });

  it('lista de preços: exige a lista, cria-a quando pedido, importa escalões e repetir não duplica', async () => {
    const csv = 'sku;escalao_min_qtd;preco\nLIC-1;0;"25,00"\nLIC-1;50;"22,50"\nIMP-1;;90\n';
    expect((await importCsv(prisma, { type: 'price-list-items', csv })).errors[0]!.message).toMatch(/lista de preços/);
    expect((await importCsv(prisma, { type: 'price-list-items', csv, priceList: 'Inexistente' })).errors[0]!.message).toMatch(/não existe/);

    const r = await importCsv(prisma, { type: 'price-list-items', csv, priceList: 'Geral EUR', createList: { currency: 'EUR', validFrom: '2026-01-01' } });
    expect(r).toMatchObject({ created: 3, applied: true, errors: [] });
    const list = await prisma.priceList.findFirstOrThrow({ where: { name: 'Geral EUR' }, include: { items: true } });
    expect(list.items).toHaveLength(3);
    expect(list.items.map((i) => i.unitPrice.toFixed(2)).sort()).toEqual(['22.50', '25.00', '90.00']);

    expect(await importCsv(prisma, { type: 'price-list-items', csv, priceList: 'Geral EUR' })).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(await importCsv(prisma, { type: 'price-list-items', csv: csv.replace('"25,00"', '"26,00"'), priceList: 'Geral EUR' })).toMatchObject({ created: 0, updated: 1, unchanged: 2 });
  });

  it('lista de preços: produto inexistente, escalão repetido e nova lista sobreposta são recusados', async () => {
    const r = await importCsv(prisma, { type: 'price-list-items', csv: 'sku;escalao_min_qtd;preco\nNADA;0;1\nLIC-1;0;1\nLIC-1;0;2\nLIC-1;0;abc\n', priceList: 'Geral EUR' });
    expect(r.errors.map((e) => `${e.line}:${e.column}`)).toEqual(['2:sku', '4:sku', '5:unitPrice', '5:sku']); // a linha 5 tem preço inválido e repete o escalão da linha 3
    const clash = await importCsv(prisma, { type: 'price-list-items', csv: 'sku;preco\nLIC-1;1\n', priceList: 'Outra', createList: { currency: 'EUR', validFrom: '2026-06-01' } });
    expect(clash.errors[0]!.message).toMatch(/sobrepõe/);
    expect(await prisma.priceList.count({ where: { name: 'Outra' } })).toBe(0);
  });
});
