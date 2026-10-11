import { UnprocessableEntityException } from '@nestjs/common';

const MAX_DEPTH = 10;
const MAX_NODES = 500;
const MAX_BYTES = 10_000;

/**
 * Limita o tamanho e a profundidade das condições JSONLogic (regras e políticas), que o servidor avalia a cada cotação:
 * evita condições gigantes ou muito aninhadas que gastem CPU/memória. Lança 422 se excederem.
 */
export function assertSafeCondition(condition: unknown): void {
  if (condition === null || condition === undefined) return;
  let nodes = 0;
  const walk = (v: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) throw new UnprocessableEntityException(`Condição demasiado aninhada (máx. ${MAX_DEPTH} níveis)`);
    if (++nodes > MAX_NODES) throw new UnprocessableEntityException(`Condição demasiado grande (máx. ${MAX_NODES} elementos)`);
    if (Array.isArray(v)) v.forEach((x) => walk(x, depth + 1));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => walk(x, depth + 1));
  };
  walk(condition, 1);
  if (JSON.stringify(condition).length > MAX_BYTES) throw new UnprocessableEntityException(`Condição demasiado grande (máx. ${MAX_BYTES} bytes)`);
}
