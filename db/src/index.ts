import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/client.js';

export * from './generated/client.js';

/** Cliente Prisma sobre o driver MariaDB; as ligações ficam em UTC (ver Arquitetura.md). */
export function createPrisma(databaseUrl: string): PrismaClient {
  const u = new URL(databaseUrl);
  const adapter = new PrismaMariaDb({
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    connectionLimit: 10,
    timezone: 'Z',
    initSql: "SET time_zone = '+00:00'",
  });
  return new PrismaClient({ adapter });
}
