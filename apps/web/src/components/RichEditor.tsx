import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { imageToDataUrl, srcToDataUrl } from '../lib/images';
import { cn } from '../lib/utils';

interface Props {
  html: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  tags?: Array<{ tag: string; description: string }>;
  label: string;
}

function Btn({ on, active, children, title, disabled }: { on: () => void; active?: boolean; children: React.ReactNode; title: string; disabled?: boolean }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={on}
      className={cn('min-w-8 rounded-[8px] px-2 py-1 text-sm transition-colors hover:bg-[var(--fill)] disabled:opacity-40', active && 'bg-[var(--primary-soft)] font-semibold text-[var(--primary)]')}>
      {children}
    </button>
  );
}

const OK_SRC = /^data:image\/(png|jpeg);base64,/i;

/**
 * Depois de colar: converte as imagens que não são PNG/JPEG em base64 (GIF/WebP, ligações https ou blob) e remove as que o browser
 * não consegue ler (por exemplo `file:///` do Word). Devolve quantas ficaram de fora.
 */
async function normalizeImages(editor: Editor): Promise<number> {
  const found = new Set<string>();
  editor.state.doc.descendants((n) => { if (n.type.name === 'image' && typeof n.attrs['src'] === 'string') found.add(n.attrs['src'] as string); });
  const todo = [...found].filter((src) => !OK_SRC.test(src) || src.length > 1_400_000);
  if (todo.length === 0) return 0;
  const replaced = new Map<string, string | null>();
  await Promise.all(todo.map(async (src) => { replaced.set(src, await srcToDataUrl(src)); }));
  const { tr } = editor.state;
  const edits: Array<{ pos: number; size: number; src: string | null }> = [];
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'image' && replaced.has(n.attrs['src'] as string)) edits.push({ pos, size: n.nodeSize, src: replaced.get(n.attrs['src'] as string) ?? null });
  });
  for (const e of edits.reverse()) { // do fim para o início: as posições anteriores não mudam
    if (e.src) tr.setNodeMarkup(e.pos, undefined, { ...editor.state.doc.nodeAt(e.pos)!.attrs, src: e.src });
    else tr.delete(e.pos, e.pos + e.size);
  }
  editor.view.dispatch(tr);
  return edits.filter((e) => !e.src).length;
}

/** Editor de texto (TipTap) limitado ao subconjunto de formatação que o documento suporta. */
export function RichEditor({ html, onChange, disabled, tags, label }: Props) {
  const { t } = useTranslation();
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);

  /** Insere ficheiros de imagem (colados, largados ou escolhidos) na posição atual. */
  const insertFiles = useCallback(async (files: File[], at?: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    let failed = 0;
    for (const f of files) {
      const src = await imageToDataUrl(f);
      if (!src) { failed++; continue; }
      const node = { type: 'image', attrs: { src, alt: f.name.replace(/\.[^.]+$/, '').slice(0, 200) } };
      if (at !== undefined) ed.chain().focus().insertContentAt(at, node).run();
      else ed.chain().focus().insertContentAt(ed.state.selection.to, node).run(); // depois da seleção: não substitui uma imagem selecionada
    }
    setNotice(failed ? t('editor.imageFailed', { count: failed }) : null);
  }, [t]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false, strike: false }),
      TableKit,
      Image.configure({ allowBase64: true, inline: false }),
    ],
    content: html,
    editable: !disabled,
    shouldRerenderOnTransaction: true, // a barra mostra o estado atual (negrito, tabela…)
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: { 'aria-label': label, class: 'prose-editor min-h-[8rem] px-4 py-3 outline-none' },
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        if (!data) return false;
        const images = [...data.files].filter((f) => f.type.startsWith('image/'));
        const hasText = data.types.includes('text/html') || data.types.includes('text/plain');
        if (images.length && !hasText) { void insertFiles(images); return true; } // captura de ecrã ou imagem copiada
        // texto formatado (Word, Excel, Google Docs, página web): o TipTap converte e depois tratamos as imagens
        setTimeout(() => {
          const ed = editorRef.current;
          if (ed) void normalizeImages(ed).then((n) => setNotice(n ? t('editor.imageDropped', { count: n }) : null));
        }, 0);
        return false;
      },
      handleDrop: (view, event) => {
        const images = [...(event.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
        if (!images.length) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles(images, at);
        return true;
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => {
    if (editor && editor.getHTML() !== html) editor.commands.setContent(html, { emitUpdate: false });
  }, [html, editor]);
  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);

  if (!editor) return null;
  return (
    <div className="overflow-hidden rounded-[var(--radius)] bg-[var(--surface)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--border)] transition-shadow focus-within:ring-2 focus-within:ring-[var(--primary)]">
      {!disabled && editor.isActive('table') && (
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--separator)] bg-[var(--primary-soft)] p-1.5 text-xs" role="toolbar" aria-label={t('editor.tableTools')}>
          <Btn title={t('editor.addRow')} on={() => editor.chain().focus().addRowAfter().run()}>＋ {t('editor.row')}</Btn>
          <Btn title={t('editor.addColumn')} on={() => editor.chain().focus().addColumnAfter().run()}>＋ {t('editor.column')}</Btn>
          <Btn title={t('editor.deleteRow')} on={() => editor.chain().focus().deleteRow().run()}>－ {t('editor.row')}</Btn>
          <Btn title={t('editor.deleteColumn')} on={() => editor.chain().focus().deleteColumn().run()}>－ {t('editor.column')}</Btn>
          <Btn title={t('editor.mergeCells')} on={() => editor.chain().focus().mergeCells().run()}>{t('editor.merge')}</Btn>
          <Btn title={t('editor.headerRow')} on={() => editor.chain().focus().toggleHeaderRow().run()}>{t('editor.header')}</Btn>
          <Btn title={t('editor.deleteTable')} on={() => editor.chain().focus().deleteTable().run()}>{t('editor.deleteTable')}</Btn>
        </div>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--separator)] bg-[var(--muted)] p-1.5">
          <Btn title={t('editor.bold')} on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>B</Btn>
          <Btn title={t('editor.italic')} on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><em>I</em></Btn>
          <Btn title={t('editor.underline')} on={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')}><u>U</u></Btn>
          <Btn title={t('editor.h2')} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H2</Btn>
          <Btn title={t('editor.h3')} on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>H3</Btn>
          <Btn title={t('editor.bullets')} on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>•</Btn>
          <Btn title={t('editor.numbers')} on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}>1.</Btn>
          <Btn title={t('editor.table')} on={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦</Btn>
          <Btn title={t('editor.image')} on={() => fileInput.current?.click()}>🖼</Btn>
          <input ref={fileInput} type="file" accept="image/*" multiple hidden aria-label={t('editor.image')} data-testid="editor-image-input"
            onChange={(e) => { void insertFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          {tags && (
            <select aria-label={t('editor.insertTag')} className="ml-auto rounded-[8px] border-0 bg-[var(--fill)] px-2 py-1 text-xs" value=""
              onChange={(e) => { if (e.target.value) editor.chain().focus().insertContent(e.target.value).run(); }}>
              <option value="">{t('editor.insertTag')}</option>
              {tags.map((x) => <option key={x.tag} value={x.tag} title={x.description}>{x.tag}</option>)}
            </select>
          )}
        </div>
      )}
      {notice && <p role="status" className="border-b border-[var(--separator)] bg-[var(--warning-soft,#fff4e5)] px-4 py-2 text-xs text-[var(--text-secondary,#555)]">{notice}</p>}
      <EditorContent editor={editor} />
    </div>
  );
}
