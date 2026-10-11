import { describe, expect, it } from 'vitest';
import { hashPassword, temporaryPassword, validatePassword, verifyPassword } from './password.js';

describe('palavras-passe', () => {
  it('faz hash com sal e verifica', async () => {
    const h = await hashPassword('Demo-Pass-2026!');
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('Demo-Pass-2026!', h)).toBe(true);
    expect(await verifyPassword('demo-pass-2026!', h)).toBe(false);
    expect(await hashPassword('Demo-Pass-2026!')).not.toBe(h); // sal diferente
  });

  it('recusa hashes inválidos ou ausentes', async () => {
    expect(await verifyPassword('x', null)).toBe(false);
    expect(await verifyPassword('x', 'texto-solto')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$4$5')).toBe(false);
  });

  it('normaliza Unicode (a mesma palavra-passe em formas diferentes)', async () => {
    const h = await hashPassword('Cação-Forte-2026');
    expect(await verifyPassword('Cação-Forte-2026'.normalize('NFD'), h)).toBe(true);
  });

  it('valida a política', () => {
    expect(validatePassword('curta1A!')).toMatch(/10 caracteres/);
    expect(validatePassword('apenasminusculas')).toMatch(/três tipos/);
    expect(validatePassword('Carla-Comercial-1', 'carla.comercial@exemplo.pt')).toBeNull();
    expect(validatePassword('xxcarla.comercialXX1', 'carla.comercial@exemplo.pt')).toMatch(/email/);
    expect(validatePassword('Demo-Pass-2026!')).toBeNull();
  });

  it('as temporárias cumprem a política e não se repetem', () => {
    const a = temporaryPassword();
    expect(validatePassword(a)).toBeNull();
    expect(temporaryPassword()).not.toBe(a);
  });
});
