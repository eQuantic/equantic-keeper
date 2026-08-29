/**
 * The two faces of an attachment list: picking files while editing an item, and
 * opening them while reading it.
 *
 * The viewer is loaded on demand. pdf.js is by far the heaviest thing this app
 * ships, and most sessions never open a scan — making every unlock pay for it
 * would be a poor trade.
 */
import { Suspense, lazy, useRef, useState } from 'react';
import { ACCEPT_ATTRIBUTE, MAX_ATTACHMENT_BYTES, formatBytes, isPdf } from '../lib/attachments';
import type { AttachmentRef } from '../lib/model';
import { useKeeper } from '../state/keeper';
import { Icon } from './icons';
import { Button, IconButton, Spinner } from './ui';

const AttachmentViewer = lazy(() =>
  import('./AttachmentViewer').then((module) => ({ default: module.AttachmentViewer })),
);

function TypeIcon({ ref: attachment }: { ref: AttachmentRef }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
      <Icon name={isPdf(attachment) ? 'file' : 'image'} size={15} />
    </span>
  );
}

/** Read-only list: click a row to open the file inside the app. */
export function AttachmentList({ refs }: { refs: AttachmentRef[] }) {
  const [openAt, setOpenAt] = useState<number | null>(null);
  if (refs.length === 0) return null;

  return (
    <>
      <div className="space-y-1.5 py-3">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">
          {refs.length === 1 ? 'Anexo' : `Anexos (${refs.length})`}
        </p>
        {refs.map((attachment, index) => (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setOpenAt(index)}
            className="flex w-full items-center gap-3 rounded-lg border border-line bg-canvas p-2 text-left transition hover:border-accent/50 hover:bg-raised"
          >
            <TypeIcon ref={attachment} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{attachment.name}</span>
              <span className="block text-xs text-faint">
                {formatBytes(attachment.size)}
                {attachment.driveFileId ? '' : ' · aguardando envio ao Drive'}
              </span>
            </span>
            <Icon name="eye" size={15} />
          </button>
        ))}
      </div>

      {openAt !== null ? (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center gap-2 bg-black/85 text-sm text-white/70">
              <Spinner /> Carregando visualizador…
            </div>
          }
        >
          <AttachmentViewer refs={refs} startAt={openAt} onClose={() => setOpenAt(null)} />
        </Suspense>
      ) : null}
    </>
  );
}

/**
 * Editing side. Files are encrypted and cached the moment they are chosen, but
 * the reference only reaches the vault when the item is saved — so cancelling
 * an edit cannot leave a half-attached document behind.
 */
export function AttachmentPicker({
  refs,
  onChange,
}: {
  refs: AttachmentRef[];
  onChange: (refs: AttachmentRef[]) => void;
}) {
  const { actions } = useKeeper();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const added: AttachmentRef[] = [];
    for (const file of files) {
      try {
        added.push(await actions.prepareAttachment(file));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : `Falha ao anexar ${file.name}.`);
      }
    }
    if (added.length) onChange([...refs, ...added]);
    setBusy(false);
  };

  const remove = (attachment: AttachmentRef) => {
    onChange(refs.filter((entry) => entry.id !== attachment.id));
    void actions.discardAttachment(attachment);
  };

  return (
    <div className="space-y-2">
      {refs.map((attachment) => (
        <div key={attachment.id} className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-2">
          <TypeIcon ref={attachment} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">{attachment.name}</span>
            <span className="block text-xs text-faint">{formatBytes(attachment.size)}</span>
          </span>
          <IconButton icon="trash" label={`Remover ${attachment.name}`} onClick={() => remove(attachment)} />
        </div>
      ))}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        aria-label="Escolher arquivos para anexar"
        onChange={(event) => {
          // Copy the list before clearing the input: `event.target.files` is a
          // live FileList, so resetting the value empties it and the upload
          // would silently do nothing.
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          void add(files);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="paperclip" loading={busy} onClick={() => inputRef.current?.click()}>
          Anexar arquivo
        </Button>
        <span className="text-xs text-faint">
          PDF, JPG, PNG ou WebP · até {formatBytes(MAX_ATTACHMENT_BYTES)} por arquivo
        </span>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
