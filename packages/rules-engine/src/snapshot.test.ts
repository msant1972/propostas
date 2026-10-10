import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson, snapshotHash } from './snapshot.js';

describe('snapshot', () => {
  it('JSON canónico ignora a ordem das chaves e os undefined', () => {
    expect(canonicalJson({ b: 2, a: { z: 1, y: [3, { d: 1, c: 2 }] }, u: undefined })).toBe('{"a":{"y":[3,{"c":2,"d":1}],"z":1},"b":2}');
  });

  it('o hash é o SHA-256 do JSON canónico', () => {
    const value = { total: '246.00', lines: [{ n: 1 }] };
    expect(snapshotHash(value)).toBe(createHash('sha256').update(canonicalJson(value)).digest('hex'));
    expect(snapshotHash(value)).toHaveLength(64);
  });

  it('qualquer alteração muda o hash', () => {
    expect(snapshotHash({ a: '1.00' })).not.toBe(snapshotHash({ a: '1.01' }));
  });

  it('recusa números não finitos', () => {
    expect(() => canonicalJson({ a: Infinity })).toThrow();
  });
});
