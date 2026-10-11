/**
 * Impasse (deadlock) ou conflito de escrita entre transações concorrentes: o MariaDB aborta uma delas
 * (P2034 no Prisma, erro 1020 com innodb_snapshot_isolation) e a operação é segura de repetir.
 */
export function isWriteConflict(e: unknown): boolean {
  const err = e as { code?: string; message?: string; cause?: { errno?: number; message?: string } } | null;
  if (err?.code === 'P2034') return true;
  const text = `${err?.message ?? ''} ${err?.cause?.message ?? ''}`;
  return err?.cause?.errno === 1020 || err?.cause?.errno === 1213 || /\(errno: ?(1020|1213)\)|deadlock|Record has changed since last read/i.test(text);
}

export async function retryOnConflict<T>(fn: () => Promise<T>, attempts = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (!isWriteConflict(e) || i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 10 * i + Math.random() * 20 * i));
    }
  }
}
