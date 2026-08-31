/**
 * The block bar above the page: every block type one click away.
 *
 * The slash menu is faster once you know it exists — and that is the catch, so
 * the same commands sit here in the open, with the hint that `/` does it too.
 * Buttons commit on mousedown, never on click: a click would blur the editor
 * first and the command would land on a lost selection.
 */
import type { Editor } from '@tiptap/core';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Block glyphs, drawn here: the app's icon set speaks about documents, not
 *  about paragraphs, and a borrowed icon teaches the wrong thing. */
const GLYPHS: Record<string, React.ReactNode> = {
  bullet: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  ),
  todo: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="7" height="7" rx="1.6" />
      <path d="m4.6 7.6 1.5 1.5L9 6.2M13 6h8M13 12h8M13 18h8" />
    </svg>
  ),
  quote: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="M6 5v14M10 7h9M10 12h9M10 17h6" />
    </svg>
  ),
  code: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="m9 8-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  ),
  table: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M9 10v9" />
    </svg>
  ),
  callout: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="M12 4 3 19h18z" />
      <path d="M12 10v4M12 16.5v.01" />
    </svg>
  ),
  toggle: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="m8 5 6 5-6 5" />
      <path d="M17 19H9" />
    </svg>
  ),
  divider: (
    <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 12h16" />
      <path d="M7 7h10M7 17h10" opacity=".4" />
    </svg>
  ),
};

interface Tool {
  label: string;
  title: string;
  glyph?: keyof typeof GLYPHS;
  text?: string;
  run: (editor: Editor) => void;
  active?: (editor: Editor) => boolean;
}

const TOOLS: (Tool | 'divider')[] = [
  {
    label: 'H1',
    title: 'Título 1',
    text: 'H1',
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    active: (editor) => editor.isActive('heading', { level: 1 }),
  },
  {
    label: 'H2',
    title: 'Título 2',
    text: 'H2',
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    active: (editor) => editor.isActive('heading', { level: 2 }),
  },
  {
    label: 'H3',
    title: 'Título 3',
    text: 'H3',
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    active: (editor) => editor.isActive('heading', { level: 3 }),
  },
  'divider',
  {
    label: 'Lista',
    glyph: 'bullet',
    title: 'Lista com marcadores',
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
    active: (editor) => editor.isActive('bulletList'),
  },
  {
    label: 'Numerada',
    title: 'Lista numerada',
    text: '1.',
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    active: (editor) => editor.isActive('orderedList'),
  },
  {
    label: 'To-do',
    glyph: 'todo',
    title: 'Lista de tarefas',
    run: (editor) => editor.chain().focus().toggleTaskList().run(),
    active: (editor) => editor.isActive('taskList'),
  },
  'divider',
  {
    label: 'Citação',
    glyph: 'quote',
    title: 'Citação',
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    active: (editor) => editor.isActive('blockquote'),
  },
  {
    label: 'Código',
    glyph: 'code',
    title: 'Bloco de código',
    run: (editor) => editor.chain().focus().setCodeBlockShiki().run(),
    active: (editor) => editor.isActive('codeBlockShiki'),
  },
  {
    label: 'Tabela',
    glyph: 'table',
    title: 'Tabela',
    run: (editor) => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run(),
  },
  {
    label: 'Destaque',
    glyph: 'callout',
    title: 'Destaque',
    run: (editor) => editor.chain().focus().setCallout().run(),
    active: (editor) => editor.isActive('callout'),
  },
  {
    label: 'Alternável',
    glyph: 'toggle',
    title: 'Bloco alternável',
    run: (editor) => editor.chain().focus().setToggle().run(),
    active: (editor) => editor.isActive('toggle'),
  },
  {
    label: 'Divisor',
    glyph: 'divider',
    title: 'Divisor',
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
];

export function BlockToolbar({ editor }: { editor: Editor }) {
  return (
    <div
      role="toolbar"
      aria-label="Blocos"
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line-soft bg-raised/35 px-3 py-1.5"
    >
      {TOOLS.map((tool, index) =>
        tool === 'divider' ? (
          <span key={`d${index}`} className="mx-1.5 h-4 w-px shrink-0 bg-line" aria-hidden="true" />
        ) : (
          <button
            key={tool.label}
            type="button"
            title={tool.title}
            aria-label={tool.title}
            aria-pressed={tool.active?.(editor) ?? false}
            onMouseDown={(event) => {
              event.preventDefault();
              tool.run(editor);
            }}
            className={`tap-target flex h-8 shrink-0 items-center justify-center rounded-lg px-2 text-[13px] font-medium transition ${
              tool.active?.(editor)
                ? 'bg-raised text-ink'
                : 'text-muted hover:bg-raised hover:text-ink'
            }`}
          >
            {tool.glyph ? GLYPHS[tool.glyph] : tool.text}
          </button>
        ),
      )}
      <span className="ml-auto hidden shrink-0 pl-3 text-xs text-faint sm:inline">ou digite /</span>
    </div>
  );
}
