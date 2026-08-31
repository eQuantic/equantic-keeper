/**
 * The note editor carries TipTap, which is most of this app's JavaScript. It is
 * loaded only when a note is actually opened — every other item, and the whole
 * unlock path, never pays for it.
 */
import { Suspense, lazy } from 'react';
import type { Block } from '../../lib/blocks';

const NoteEditorImpl = lazy(() =>
  import('./NoteEditor').then((module) => ({ default: module.NoteEditor })),
);

export function LazyNoteEditor(props: {
  blocks: Block[] | undefined;
  onChange?: (blocks: Block[]) => void;
  editable?: boolean;
  toolbar?: boolean;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-faint">Abrindo o editor…</p>}>
      <NoteEditorImpl {...props} />
    </Suspense>
  );
}
