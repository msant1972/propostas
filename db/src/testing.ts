import mariadb from 'mariadb';

/**
 * Cria (se preciso) uma base de dados de testes própria de cada suite — `<base>_<sufixo>` — e devolve o URL.
 * Assim os pacotes correm em paralelo sem se pisarem uns aos outros.
 */
export async function testDatabase(baseUrl: string, suffix: string): Promise<string> {
  const u = new URL(baseUrl);
  const name = `${u.pathname.slice(1)}_${suffix}`.replace(/[^A-Za-z0-9_]/g, '_');
  const conn = await mariadb.createConnection({
    host: u.hostname, port: Number(u.port || 3306), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await conn.end();
  }
  u.pathname = `/${name}`;
  return u.toString();
}
