import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

describe('validateEnv', () => {
  const base = { DATABASE_URL: 'mysql://x' };

  it('aplica valores por omissão', () => {
    expect(validateEnv(base).AUTH_MODE).toBe('dev');
  });

  it('recusa AUTH_MODE=dev em produção', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', AUTH_MODE: 'dev' })).toThrow(/produção/);
  });

  it('exige tenant e audience no modo entra', () => {
    expect(() => validateEnv({ ...base, AUTH_MODE: 'entra' })).toThrow(/ENTRA_TENANT_ID/);
  });
});
