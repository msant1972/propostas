import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 32768; // custo de memória/CPU: ~32 MB e algumas dezenas de ms por verificação
const R = 8;
const P = 1;
const KEYLEN = 32;

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (e, k) => (e ? reject(e) : resolve(k))));

/** Hash com scrypt e sal aleatório; formato `scrypt$N$r$p$sal$hash` (os parâmetros ficam junto, para poderem evoluir). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 });
  return timingSafeEqual(key, expected);
}

/** Hash de um valor de referência, para gastar o mesmo tempo quando o utilizador não existe (evita enumerar emails). */
export const DUMMY_HASH_PROMISE = hashPassword('nao-existe-utilizador-com-esta-palavra-passe');

const COMMON = new Set(['password', 'palavra-passe', 'qwertyuiop', '1234567890', 'passw0rd123', 'changeme123']);

/** Regras mínimas de palavra-passe: 10 caracteres, três classes, nada óbvio. Devolve a mensagem de erro, ou null. */
export function validatePassword(password: string, email = ''): string | null {
  if (password.length < 10) return 'A palavra-passe tem de ter pelo menos 10 caracteres';
  if (password.length > 128) return 'A palavra-passe é demasiado longa';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return 'Use pelo menos três tipos de caracteres (minúsculas, maiúsculas, números, símbolos)';
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return 'A palavra-passe não pode conter o seu email';
  if (COMMON.has(password.toLowerCase())) return 'Palavra-passe demasiado comum';
  return null;
}

/** Palavra-passe temporária legível (administrador → utilizador), a mudar no primeiro acesso. */
export function temporaryPassword(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const b = 'abcdefghijkmnpqrstuvwxyz';
  const d = '23456789';
  const pick = (s: string, n: number) => Array.from(randomBytes(n), (x) => s[x % s.length]).join('');
  return `${pick(a, 3)}${pick(b, 4)}-${pick(d, 4)}-${pick(a, 2)}${pick(b, 3)}`;
}
