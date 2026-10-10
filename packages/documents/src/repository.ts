import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export type Folder = '01_Trabalho' | '02_Enviado' | '03_Assinado';

export interface StoredFile {
  /** Caminho relativo à raiz do repositório (estável: é o que a base de dados guarda). */
  storageKey: string;
  sha256: string;
  sizeBytes: number;
}

/**
 * Repositório de documentos. A implementação em produção é uma pasta local do servidor; a interface existe
 * para os testes e para uma eventual troca de repositório.
 */
export interface DocumentRepository {
  put(input: { clientCode: string; proposalCode: string; folder: Folder; fileName: string; bytes: Buffer }): Promise<StoredFile>;
  get(storageKey: string): Promise<Buffer>;
  /** Copia para outra pasta da mesma proposta (ex.: 01_Trabalho → 02_Enviado). */
  copyTo(storageKey: string, folder: Folder): Promise<StoredFile>;
  /** SHA-256 do ficheiro tal como está agora em disco, ou null se já não existir. */
  currentHash(storageKey: string): Promise<string | null>;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Transforma texto livre num segmento de caminho seguro (sem separadores, pontos iniciais nem caracteres estranhos). */
export function safeSegment(s: string): string {
  const cleaned = s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  if (!cleaned) throw new Error('Nome de ficheiro/pasta inválido');
  return cleaned;
}

export class LocalDocumentRepository implements DocumentRepository {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /** Resolve a chave dentro da raiz; recusa qualquer tentativa de sair dela (path traversal). */
  private abs(storageKey: string): string {
    const p = resolve(this.root, storageKey);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error('Caminho fora do repositório');
    return p;
  }

  async put(i: { clientCode: string; proposalCode: string; folder: Folder; fileName: string; bytes: Buffer }): Promise<StoredFile> {
    const storageKey = ['Clientes', safeSegment(i.clientCode), safeSegment(i.proposalCode), i.folder, safeSegment(i.fileName)].join('/');
    const file = this.abs(storageKey);
    await mkdir(dirname(file), { recursive: true });
    // 'wx': nunca sobrescreve; cada geração produz um ficheiro novo e o anterior fica no histórico.
    const fh = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o640);
    try {
      await fh.writeFile(i.bytes);
      await fh.sync();
    } finally {
      await fh.close();
    }
    return { storageKey, sha256: sha256(i.bytes), sizeBytes: i.bytes.length };
  }

  async get(storageKey: string): Promise<Buffer> {
    return readFile(this.abs(storageKey));
  }

  async copyTo(storageKey: string, folder: Folder): Promise<StoredFile> {
    const parts = storageKey.split('/');
    if (parts.length !== 5 || parts[0] !== 'Clientes') throw new Error('Chave de armazenamento inválida');
    const target = [...parts.slice(0, 3), folder, parts[4]!].join('/');
    const dst = this.abs(target);
    await mkdir(dirname(dst), { recursive: true });
    await copyFile(this.abs(storageKey), dst, constants.COPYFILE_EXCL);
    const bytes = await readFile(dst);
    return { storageKey: target, sha256: sha256(bytes), sizeBytes: bytes.length };
  }

  async currentHash(storageKey: string): Promise<string | null> {
    try {
      const file = this.abs(storageKey);
      await stat(file);
      return sha256(await readFile(file));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  /** Para testes e diagnóstico. */
  fullPath(storageKey: string): string {
    return this.abs(storageKey);
  }
}

