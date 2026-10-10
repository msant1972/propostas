import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

/**
 * Executor de migrações SQL: `migrate up` aplica as pendentes, `migrate down` reverte a última.
 * Cada pasta em db/migrations tem up.sql e down.sql.
 */
/** Um ficheiro pode conter várias instruções separadas por uma linha `-- split` (ex.: triggers). */
async function runSql(conn: { query(sql: string): Promise<unknown> }, file: string): Promise<void> {
  for (const part of readFileSync(file, 'utf8').split(/^-- split$/m)) {
    if (part.trim()) await conn.query(part);
  }
}

const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'migrations');

export async function migrate(databaseUrl: string, direction: 'up' | 'down' = 'up'): Promise<string[]> {
  const u = new URL(databaseUrl);
  const conn = await mariadb.createConnection({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    multipleStatements: true,
    timezone: 'Z',
  });
  try {
    await conn.query("SET time_zone = '+00:00'");
    await conn.query(
      'CREATE TABLE IF NOT EXISTS _migrations (name VARCHAR(100) PRIMARY KEY, applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6))',
    );
    const applied = new Set<string>((await conn.query('SELECT name FROM _migrations')).map((r: { name: string }) => r.name));
    const all = readdirSync(dir).filter((d) => /^\d{4}_/.test(d)).sort();
    const done: string[] = [];

    if (direction === 'up') {
      for (const name of all.filter((n) => !applied.has(n))) {
        await runSql(conn, join(dir, name, 'up.sql'));
        await conn.query('INSERT INTO _migrations (name) VALUES (?)', [name]);
        done.push(name);
      }
    } else {
      const last = [...all].reverse().find((n) => applied.has(n));
      if (last) {
        await runSql(conn, join(dir, last, 'down.sql'));
        await conn.query('DELETE FROM _migrations WHERE name = ?', [last]);
        done.push(last);
      }
    }
    return done;
  } finally {
    await conn.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const direction = process.argv[2] === 'down' ? 'down' : 'up';
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL em falta');
  const done = await migrate(url, direction);
  console.log(done.length ? `${direction}: ${done.join(', ')}` : 'nada a fazer');
}
