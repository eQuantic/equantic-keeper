/**
 * React node-views for the custom blocks, in Keeper's clothes.
 *
 * Ported from eQuantic Space's `apps/platform` node-views: same nodes, same
 * attributes — so a note round-trips between the two products — but styled with
 * this app's tokens and without its icon library.
 *
 * Deliberately plain for now: a mermaid diagram, an equation and an embed are
 * EDITED here (their source is kept intact and travels with the note) but not
 * rendered — that needs mermaid/KaTeX, and this app precaches every byte it
 * ships for offline use, so those come next, lazily. Nothing is lost meanwhile.
 */
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Icon } from '../icons';

const CALLOUT_ICONS = ['💡', '⚠️', '✅', '❌', '📌', '🔥', '📝', 'ℹ️'];

export function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const icon = typeof node.attrs.icon === 'string' ? node.attrs.icon : '💡';
  return (
    <NodeViewWrapper className="my-2 flex gap-2.5 rounded-lg border border-line bg-raised px-3 py-2.5">
      <button
        type="button"
        contentEditable={false}
        disabled={!editor.isEditable}
        title="Mudar ícone"
        onClick={() => updateAttributes({ icon: CALLOUT_ICONS[(CALLOUT_ICONS.indexOf(icon) + 1) % CALLOUT_ICONS.length] })}
        className="h-6 shrink-0 text-base leading-none select-none"
      >
        {icon}
      </button>
      <NodeViewContent className="min-w-0 flex-1" />
    </NodeViewWrapper>
  );
}

export function ToggleView({ node, updateAttributes }: ReactNodeViewProps) {
  const open = node.attrs.open !== false;
  return (
    <NodeViewWrapper className="my-1" data-open={open ? 'true' : 'false'}>
      <div className="flex gap-1.5">
        <button
          type="button"
          contentEditable={false}
          title={open ? 'Recolher' : 'Expandir'}
          onClick={() => updateAttributes({ open: !open })}
          className="mt-1 h-5 w-4 shrink-0 text-faint transition hover:text-ink"
        >
          <Icon name="chevron" size={12} className={open ? 'rotate-90' : ''} />
        </button>
        {/* Collapsing hides the children with CSS: the document is never
            rewritten, so a closed toggle still syncs everything inside it. */}
        <NodeViewContent className={`min-w-0 flex-1 ${open ? '' : '[&>*:not(:first-child)]:hidden'}`} />
      </div>
    </NodeViewWrapper>
  );
}

export function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const language = typeof node.attrs.language === 'string' ? node.attrs.language : '';
  const code = typeof node.attrs.code === 'string' ? node.attrs.code : '';
  // Reading a note is reading: no input boxes, no fake affordances.
  if (!editor.isEditable) {
    return (
      <NodeViewWrapper className="my-2 overflow-hidden rounded-lg border border-line bg-canvas">
        {language ? (
          <p className="border-b border-line-soft px-3 py-1 text-xs text-faint">{language}</p>
        ) : null}
        <pre className="overflow-x-auto px-3 py-2 font-mono text-[13px] text-ink">{code}</pre>
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper className="my-2 overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-2 py-1" contentEditable={false}>
        <input
          value={language}
          onChange={(event) => updateAttributes({ language: event.target.value })}
          placeholder="linguagem"
          aria-label="Linguagem do código"
          className="w-32 bg-transparent px-1 text-xs text-muted outline-none placeholder:text-faint"
        />
        <Icon name="terminal" size={12} className="text-faint" />
      </div>
      <textarea
        value={code}
        onChange={(event) => updateAttributes({ code: event.target.value })}
        spellCheck={false}
        rows={Math.min(Math.max(code.split('\n').length, 3), 24)}
        className="block w-full resize-y bg-transparent px-3 py-2 font-mono text-[13px] text-ink outline-none"
      />
    </NodeViewWrapper>
  );
}

/** One shape for the blocks whose rendering is still to come. */
function SourceBlock({
  label,
  icon,
  value,
  placeholder,
  onChange,
  editable,
  multiline = true,
}: {
  label: string;
  icon: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  editable: boolean;
  multiline?: boolean;
}) {
  return (
    <NodeViewWrapper className="my-2 rounded-lg border border-line border-dashed bg-raised px-3 py-2">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] tracking-wide text-faint uppercase" contentEditable={false}>
        <Icon name={icon} size={11} /> {label}
      </p>
      {!editable ? (
        <pre className="overflow-x-auto font-mono text-[13px] whitespace-pre-wrap text-ink">{value}</pre>
      ) : multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          rows={Math.min(Math.max(value.split('\n').length, 2), 16)}
          className="block w-full resize-y bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          className="block w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
        />
      )}
    </NodeViewWrapper>
  );
}

export function MermaidView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  return (
    <SourceBlock
      label="Diagrama (mermaid)"
      icon="layers"
      value={typeof node.attrs.code === 'string' ? node.attrs.code : ''}
      placeholder={'graph TD;\n  A-->B;'}
      onChange={(code) => updateAttributes({ code })}
      editable={editor.isEditable}
    />
  );
}

export function EquationView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  return (
    <SourceBlock
      label="Equação (LaTeX)"
      icon="scale"
      value={typeof node.attrs.latex === 'string' ? node.attrs.latex : ''}
      placeholder="e^{i\\pi} + 1 = 0"
      onChange={(latex) => updateAttributes({ latex })}
      editable={editor.isEditable}
    />
  );
}

/**
 * An embed and an image are just their address here: this app has no business
 * fetching a third-party URL from inside a note — the request alone would tell
 * that server which document was opened, and the page's CSP forbids it anyway.
 * The address is kept, clickable, and the file itself belongs in Anexos.
 */
export function EmbedView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const url = typeof node.attrs.url === 'string' ? node.attrs.url : '';
  return (
    <SourceBlock
      label="Incorporação"
      icon="link"
      value={url}
      placeholder="https://…"
      multiline={false}
      editable={editor.isEditable}
      onChange={(next) => updateAttributes({ url: next })}
    />
  );
}

export function ImageBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
  return (
    <SourceBlock
      label="Imagem (endereço)"
      icon="image"
      value={src}
      placeholder="https://…  ·  ou anexe o arquivo ao item"
      multiline={false}
      editable={editor.isEditable}
      onChange={(next) => updateAttributes({ src: next })}
    />
  );
}

export function FileBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const name = typeof node.attrs.name === 'string' ? node.attrs.name : '';
  return (
    <SourceBlock
      label="Arquivo"
      icon="paperclip"
      value={name}
      placeholder="nome do arquivo — anexe-o em Anexos"
      multiline={false}
      editable={editor.isEditable}
      onChange={(next) => updateAttributes({ name: next })}
    />
  );
}
