import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mariadb from 'mariadb';

/** Procura a pasta `migrations` subindo a partir deste ficheiro (funciona em src/ e em dist/). */
function migrationsDir(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++, d = dirname(d)) {
    if (existsSync(join(d, 'migrations'))) return join(d, 'migrations');
  }
  throw new Error('Pasta de migrações não encontrada');
}

/** Um ficheiro pode conter várias instruções separadas por uma linha `-- split` (ex.: triggers). */
async function runSql(conn: { query(sql: string): Promise<unknown> }, file: string): Promise<void> {
  for (const part of readFileSync(file, 'utf8').split(/^-- split$/m)) {
    if (part.trim()) await conn.query(part);
  }
}

/**
 * Executor de migrações SQL: `up` aplica as pendentes, `down` reverte a última.
 * Cada pasta em db/migrations tem up.sql e down.sql.
 */
export async function migrate(databaseUrl: string, direction: 'up' | 'down' = 'up'): Promise<string[]> {
  const dir = migrationsDir();
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
    // Uma só execução de cada vez por base de dados (suites e instâncias a arrancar em simultâneo).
    await conn.query("SELECT GET_LOCK('cpq_migrate', 120)");
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
    await conn.query("SELECT RELEASE_LOCK('cpq_migrate')").catch(() => undefined);
    await conn.end();
  }
}
