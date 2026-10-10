import 'dotenv/config';
import mariadb from 'mariadb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@cpq/shared';
import { createPrisma } from '../src/index.js';
import { migrate } from '../src/migrate.js';
import { testDatabase } from '../src/testing.js';

/**
 * Teste decisivo da tarefa 1.2 (ver Planeamento.md): o tipo nativo UUID da MariaDB serve para UUIDv7?
 *  1. mantém a ordem temporal dos UUIDv7 no índice da chave primária;
 *  2. o Prisma lê e escreve-o (declarado como CHAR(36) no schema) sem perdas;
 *  3. DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) funciona.
 * Se algum falhar, passa-se a BINARY(16) (ver Arquitetura.md).
 */
const base = process.env['TEST_DATABASE_URL'];
const run = describe.skipIf(!base);
let url: string;

run('compatibilidade UUID/UUIDv7 e timestamps na MariaDB', () => {
  let conn: mariadb.Connection;
  let prisma: ReturnType<typeof createPrisma>;

  beforeAll(async () => {
    url = await testDatabase(base!, 'db');
    prisma = createPrisma(url);
    const u = new URL(url);
    conn = await mariadb.createConnection({
      host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password), database: u.pathname.slice(1),
    });
    await conn.query("SET time_zone = '+00:00'");
    await migrate(url, 'up');
    await conn.query('DROP TABLE IF EXISTS spike_uuid');
    await conn.query('CREATE TABLE spike_uuid (id UUID PRIMARY KEY, n INT NOT NULL)');
  });

  afterAll(async () => {
    await conn?.query('DROP TABLE IF EXISTS spike_uuid');
    await conn?.end();
    await prisma?.$disconnect();
  });

  it('o tipo UUID ordena UUIDv7 por tempo', async () => {
    const base = 1_791_600_000_000;
    const ids = Array.from({ length: 500 }, (_, i) => ({ id: uuidv7(base + i * 37), n: i }));
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    for (const r of shuffled) await conn.query('INSERT INTO spike_uuid (id, n) VALUES (?, ?)', [r.id, r.n]);
    const rows = (await conn.query('SELECT n FROM spike_uuid ORDER BY id')) as Array<{ n: number }>;
    expect(rows.map((r) => r.n)).toEqual(ids.map((r) => r.n));
  });

  it('o Prisma faz o ciclo completo com ids UUID (CHAR(36) no schema)', async () => {
    const id = uuidv7();
    await prisma.product.create({ data: { id, sku: `SPIKE-${id.slice(-8)}`, name: 'Spike', billingModel: 'ONE_TIME' } });
    const back = await prisma.product.findUnique({ where: { id } });
    expect(back?.id).toBe(id);
    const raw = (await conn.query('SELECT id FROM products WHERE id = ?', [id])) as Array<{ id: string }>;
    expect(String(raw[0]?.id)).toBe(id);
    await prisma.product.delete({ where: { id } });
  });

  it('updated_at muda com ON UPDATE CURRENT_TIMESTAMP(6)', async () => {
    const id = uuidv7();
    await prisma.product.create({ data: { id, sku: `SPIKE-${id.slice(-8)}`, name: 'A', billingModel: 'ONE_TIME' } });
    const before = (await prisma.product.findUniqueOrThrow({ where: { id } })).updatedAt;
    await new Promise((r) => setTimeout(r, 20));
    await conn.query('UPDATE products SET name = ? WHERE id = ?', ['B', id]);
    const after = (await prisma.product.findUniqueOrThrow({ where: { id } })).updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    await prisma.product.delete({ where: { id } });
  });
});
