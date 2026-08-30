/**
 * The note body: a block editor (TipTap) over the block tree the vault stores.
 *
 * The durable model is BLOCKS — the same `SerializedBlock` shape eQuantic Space
 * persists — so what travels in the encrypted payload does not depend on an
 * editor library. `blocksToDoc` builds the document on open and `docToBlocks`
 * serializes it back on every change; both are ported from Space, which is why
 * a note can move between the two products untouched.
 *
 * The same component renders a saved note read-only (`editable={false}`), so
 * the detail view and the editor can never drift apart.
 */
import { useEffect, useMemo } from 'react';
import { EditorContent, ReactNodeViewRenderer, useEditor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import { toEditorInput, type Block } from '../../lib/blocks';
import { blocksToDoc } from '../../lib/editor/blocks-to-pm';
import { docToBlocks } from '../../lib/editor/pm-to-blocks';
import { buildDocExtensions } from '../../lib/editor/extensions';
import '../../lib/editor/tiptap-commands';
import { SlashCommand } from './slash-command';
import { BubbleToolbar } from './bubble-toolbar';
import {
  CalloutView,
  CodeBlockView,
  EmbedView,
  EquationView,
  FileBlockView,
  ImageBlockView,
  MermaidView,
  ToggleView,
} from './node-views';

const NODE_VIEWS = {
  callout: () => ReactNodeViewRenderer(CalloutView),
  toggle: () => ReactNodeViewRenderer(ToggleView),
  codeBlockShiki: () => ReactNodeViewRenderer(CodeBlockView),
  mermaid: () => ReactNodeViewRenderer(MermaidView),
  equation: () => ReactNodeViewRenderer(EquationView),
  embed: () => ReactNodeViewRenderer(EmbedView),
  imageBlock: () => ReactNodeViewRenderer(ImageBlockView),
  fileBlock: () => ReactNodeViewRenderer(FileBlockView),
};

export function NoteEditor({
  blocks,
  onChange,
  editable = true,
}: {
  blocks: Block[] | undefined;
  onChange?: (blocks: Block[]) => void;
  editable?: boolean;
}) {
  // Built once per mount: re-deriving it on every keystroke would reset the
  // document under the caret.
  const initial = useMemo(() => blocksToDoc(toEditorInput(blocks ?? [])), [blocks]);

  const editor = useEditor(
    {
      editable,
      extensions: [
        ...buildDocExtensions({ nodeViews: NODE_VIEWS }),
        ...(editable
          ? [
              SlashCommand,
              Placeholder.configure({ placeholder: 'Escreva, ou digite / para inserir um bloco' }),
            ]
          : []),
      ],
      content: initial,
      editorProps: {
        attributes: {
          class: 'keeper-note focus:outline-none',
          'data-note-editor': editable ? 'edit' : 'read',
          ...(editable ? { 'aria-label': 'Conteúdo da nota' } : {}),
        },
      },
      onUpdate: ({ editor: instance }) => onChange?.(docToBlocks(instance.getJSON())),
      // The editor is rendered inside a dialog that mounts synchronously; the
      // default deferred render would flash an empty note.
      immediatelyRender: false,
    },
    [editable],
  );

  // A note opened read-only can be replaced under us (another device synced):
  // reload the document, but never while it is being typed into.
  useEffect(() => {
    if (!editor || editable) return;
    editor.commands.setContent(initial, { emitUpdate: false });
  }, [editor, editable, initial]);

  if (!editor) return null;

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      // The pane is a sheet of paper: a click on the blank space under the last
      // line puts the caret at the end, instead of doing nothing because the
      // pointer missed the text node by a few pixels.
      onMouseDown={(event) => {
        if (!editable) return;
        const target = event.target as HTMLElement;
        if (target.closest('.keeper-note')) return;
        event.preventDefault();
        editor.commands.focus('end');
      }}
    >
      {editable ? <BubbleToolbar editor={editor} /> : null}
      <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col" />
    </div>
  );
}
