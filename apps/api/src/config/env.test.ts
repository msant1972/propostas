import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'mysql://x' };

  it('aplica valores por omissão e um segredo de desenvolvimento fora de produção', () => {
    const e = validateEnv(base);
    expect(e.AUTH_TOKEN_TTL_HOURS).toBe(8);
    expect(e.AUTH_JWT_SECRET.length).toBeGreaterThanOrEqual(32);
  });

  it('em produção exige um segredo próprio e forte', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/AUTH_JWT_SECRET/);
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', AUTH_JWT_SECRET: 'curto' })).toThrow(/mínimo 32/);
    const dev = validateEnv(base).AUTH_JWT_SECRET;
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', AUTH_JWT_SECRET: dev })).toThrow(/desenvolvimento/);
    expect(validateEnv({ ...base, NODE_ENV: 'production', AUTH_JWT_SECRET: 'x'.repeat(40) }).NODE_ENV).toBe('production');
  });

  it('recusa um segredo curto também fora de produção', () => {
    expect(() => validateEnv({ ...base, AUTH_JWT_SECRET: 'curto' })).toThrow(/32/);
  });
});
