import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Valor de uma variável do `.env` da raiz (a aplicação de desenvolvimento usa-o), para os testes usarem a mesma pasta de documentos. */
export function envFileValue(name: string): string | undefined {
  try {
    const line = readFileSync(resolve(import.meta.dirname, '../.env'), 'utf8').split('\n').find((l) => l.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}
