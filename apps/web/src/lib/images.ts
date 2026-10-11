/** Largura máxima das imagens guardadas nos conteúdos (px); acima disto reduz-se, para o documento não ficar enorme. */
const MAX_WIDTH = 1600;
/** Tamanho máximo de uma imagem depois de reduzida (o servidor recusa acima de 3 MB). */
const MAX_BYTES = 2.5 * 1024 * 1024;

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

const sizeOf = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

/**
 * Converte qualquer imagem do browser (PNG, JPEG, GIF, WebP, BMP…) em PNG ou JPEG em base64, que são os formatos que o DOCX e o PDF aceitam.
 * Reduz a largura se for preciso. Devolve `null` se não for uma imagem legível ou continuar grande demais.
 */
export async function imageToDataUrl(blob: Blob): Promise<string | null> {
  if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_WIDTH / bitmap.width);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  // PNG e JPEG pequenos não precisam de ser recodificados
  if (scale === 1 && (blob.type === 'image/png' || blob.type === 'image/jpeg') && blob.size <= MAX_BYTES) {
    bitmap.close();
    return toDataUrl(blob);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); return null; }
  const keepAlpha = blob.type === 'image/png' || blob.type === 'image/gif' || blob.type === 'image/webp';
  if (!keepAlpha) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let out = canvas.toDataURL(keepAlpha ? 'image/png' : 'image/jpeg', 0.88);
  if (sizeOf(out) > MAX_BYTES) { // PNG pesado (fotografia): passa a JPEG sobre fundo branco
    const flat = document.createElement('canvas');
    flat.width = w; flat.height = h;
    const c2 = flat.getContext('2d')!;
    c2.fillStyle = '#fff'; c2.fillRect(0, 0, w, h); c2.drawImage(canvas, 0, 0);
    out = flat.toDataURL('image/jpeg', 0.82);
  }
  return sizeOf(out) <= MAX_BYTES ? out : null;
}

/** Transforma uma imagem referida por URL (`data:`, `blob:`, `https:`) em base64; falha em silêncio (devolve `null`) se o browser não a deixar ler (CORS, `file:`). */
export async function srcToDataUrl(src: string): Promise<string | null> {
  if (!/^(data:|blob:|https?:)/i.test(src)) return null;
  try {
    const res = await fetch(src, { credentials: 'omit' });
    if (!res.ok) return null;
    return await imageToDataUrl(await res.blob());
  } catch {
    return null;
  }
}
