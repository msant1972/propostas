import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
      className={cn('rounded px-2 py-1 text-sm hover:bg-[var(--muted)] disabled:opacity-40', active && 'bg-[var(--muted)] font-semibold')}>
      {children}
    </button>
  );
}

/** Editor de texto (TipTap) limitado ao subconjunto de formatação que o documento suporta. */
export function RichEditor({ html, onChange, disabled, tags, label }: Props) {
  const { t } = useTranslation();
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, code: false, codeBlock: false, blockquote: false, horizontalRule: false, strike: false }), TableKit],
    content: html,
    editable: !disabled,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: { attributes: { 'aria-label': label, class: 'prose-editor min-h-[8rem] px-3 py-2 outline-none' } },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== html) editor.commands.setContent(html, { emitUpdate: false });
  }, [html, editor]);
  useEffect(() => { editor?.setEditable(!disabled); }, [disabled, editor]);

  if (!editor) return null;
  return (
    <div className="rounded-md border border-[var(--border)]">
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] p-1">
          <Btn title={t('editor.bold')} on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>B</Btn>
          <Btn title={t('editor.italic')} on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><em>I</em></Btn>
          <Btn title={t('editor.underline')} on={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')}><u>U</u></Btn>
          <Btn title={t('editor.h2')} on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H2</Btn>
          <Btn title={t('editor.h3')} on={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>H3</Btn>
          <Btn title={t('editor.bullets')} on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}>•</Btn>
          <Btn title={t('editor.numbers')} on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}>1.</Btn>
          <Btn title={t('editor.table')} on={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()}>▦</Btn>
          {tags && (
            <select aria-label={t('editor.insertTag')} className="ml-auto rounded border border-[var(--border)] bg-transparent px-1 py-1 text-xs" value=""
              onChange={(e) => { if (e.target.value) editor.chain().focus().insertContent(e.target.value).run(); }}>
              <option value="">{t('editor.insertTag')}</option>
              {tags.map((x) => <option key={x.tag} value={x.tag} title={x.description}>{x.tag}</option>)}
            </select>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
