import 'dotenv/config';
import { hashPassword, isRole, uuidv7, validatePassword } from '@cpq/shared';
import { createPrisma } from '../src/index.js';

/**
 * Cria (ou atualiza) um utilizador diretamente na base de dados, sem passar pela API.
 * Uso: pnpm --filter @cpq/db user:create <email> <palavra-passe> <papel> [--nome "Nome"] [--allow-weak] [--must-change]
 * Por omissão aplica a política de palavras-passe; --allow-weak ignora-a (só para ambientes de teste).
 */
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const [email, password, role] = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--nome');

if (!email || !password || !role) {
  console.error('Uso: user:create <email> <palavra-passe> <papel> [--nome "Nome"] [--allow-weak] [--must-change]');
  process.exit(1);
}
if (!isRole(role)) {
  console.error(`Papel inválido: ${role}`);
  process.exit(1);
}
const problem = validatePassword(password, email);
if (problem && !flag('--allow-weak')) {
  console.error(`${problem}. Use --allow-weak para ignorar a política (só em ambientes de teste).`);
  process.exit(1);
}
if (problem) console.warn(`AVISO: palavra-passe fora da política (${problem})`);

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL em falta');
const prisma = createPrisma(url);
const mail = email.trim().toLowerCase();
const data = {
  displayName: opt('--nome') ?? mail.split('@')[0]!,
  rolesJson: [role],
  isActive: true,
  passwordHash: await hashPassword(password),
  mustChangePassword: flag('--must-change'),
  passwordChangedAt: new Date(),
  failedLogins: 0,
  lockedUntil: null,
  tokenVersion: { increment: 1 },
};
const user = await prisma.user.upsert({ where: { email: mail }, update: data, create: { id: uuidv7(), email: mail, ...data, tokenVersion: 1 } });
console.log(`Utilizador ${user.email} (${role}) pronto.`);
await prisma.$disconnect();
