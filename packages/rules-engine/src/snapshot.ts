import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** JSON canónico: chaves ordenadas, sem espaços, sem `undefined`; números têm de ser finitos. */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Número não finito no snapshot');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`Tipo não suportado no snapshot: ${typeof value}`);
  }
}

/** SHA-256 (hex, 64 caracteres) do JSON canónico: é o `snapshot_hash` da versão de cotação. */
export function snapshotHash(snapshot: unknown): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(snapshot))));
}
