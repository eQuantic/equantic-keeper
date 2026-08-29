/**
 * In-app viewer for the files behind a document.
 *
 * Opening a scan in another tab would hand the decrypted bytes to the browser
 * as a blob: URL that outlives the vault lock — and it drops the user out of
 * the app to read their own residence permit. So PDFs are rendered here with
 * pdf.js and images with a canvas of our own, and every object URL is revoked
 * when the viewer closes.
 *
 * pdf.js runs its parser in a worker. The worker file is bundled by Vite and
 * served from this origin, which is what the page's `worker-src 'self'` allows;
 * the CDN build the library documents would be blocked by the CSP.
 *
 * The `legacy` build is deliberate, not caution: the default one calls
 * `Map.prototype.getOrInsertComputed`, a proposal no shipping browser has yet,
 * and the text layer dies on it — the page still draws, so the failure looks
 * like "selection is broken" rather than an error. `legacy` carries the
 * polyfills. It is bigger, and it is loaded on demand anyway.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { formatBytes, isPdf } from '../lib/attachments';
import type { AttachmentRef } from '../lib/model';
import { useKeeper } from '../state/keeper';
import { Icon } from './icons';
import { IconButton, Spinner } from './ui';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Scanned documents are usually JBIG2- or CCITT-compressed, and pdf.js decodes
 * those in WebAssembly it fetches at runtime. The files are copied into the
 * build (see `vite.config.ts`) and served from this origin: the library's
 * default points at a CDN, which `connect-src 'self'` blocks — the failure
 * would show up as a blank page on exactly the scans this app exists for.
 */
const WASM_URL = `${import.meta.env.BASE_URL}pdfjs-wasm/`;

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function nextZoom(current: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  const target = (index === -1 ? ZOOM_STEPS.length - 1 : index) + direction;
  return ZOOM_STEPS[Math.min(Math.max(target, 0), ZOOM_STEPS.length - 1)] ?? current;
}

/** Renders one PDF page onto a canvas, plus the invisible text layer that
 * makes selection and copy work — the whole point of not using an <img>. */
function PdfPage({ doc, pageNumber, zoom }: { doc: PDFDocumentProxy; pageNumber: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;

    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      // Match the device pixel ratio, or a 4x zoom on a retina screen renders
      // a blurry document — which defeats the purpose of zooming into a scan.
      const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: zoom * ratio });
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / ratio}px`;
      canvas.style.height = `${viewport.height / ratio}px`;

      const render = page.render({ canvas, canvasContext: context, viewport });
      task = render;
      await render.promise.catch(() => undefined);
      if (cancelled) return;

      const layer = textRef.current;
      if (!layer) return;
      layer.replaceChildren();
      layer.style.width = `${viewport.width / ratio}px`;
      layer.style.height = `${viewport.height / ratio}px`;
      // The spans are positioned in per-cent and sized from this variable, so
      // the text stays glued to the glyphs at every zoom step.
      layer.style.setProperty('--total-scale-factor', String(zoom));
      const textLayer = new pdfjs.TextLayer({
        textContentSource: await page.getTextContent(),
        container: layer,
        viewport: page.getViewport({ scale: zoom }),
      });
      await textLayer.render().catch(() => undefined);
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, zoom]);

  return (
    <div className="relative mx-auto w-fit bg-white shadow-lg">
      <canvas ref={canvasRef} className="block" />
      <div ref={textRef} className="keeper-text-layer absolute top-0 left-0 origin-top-left" />
    </div>
  );
}

function PdfView({ blob, zoom }: { blob: Blob; zoom: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    let task: PDFDocumentLoadingTask | null = null;

    void (async () => {
      try {
        const data = new Uint8Array(await blob.arrayBuffer());
        task = pdfjs.getDocument({ data, wasmUrl: WASM_URL });
        loaded = await task.promise;
        if (cancelled) return;
        setDoc(loaded);
      } catch {
        if (!cancelled) setError('Não foi possível abrir este PDF.');
      }
    })();

    // Destroying the loading task tears down the worker with it, which is what
    // frees the decoded pages — the document proxy alone has no destroy().
    return () => {
      cancelled = true;
      loaded = null;
      void task?.destroy();
    };
  }, [blob]);

  if (error) return <p className="p-8 text-center text-sm text-danger">{error}</p>;
  if (!doc) {
    return (
      <p className="flex items-center justify-center gap-2 p-8 text-sm text-muted">
        <Spinner /> Abrindo documento…
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      {Array.from({ length: doc.numPages }, (_, index) => (
        <PdfPage key={index + 1} doc={doc} pageNumber={index + 1} zoom={zoom} />
      ))}
    </div>
  );
}

function ImageView({ url, name, zoom }: { url: string; name: string; zoom: number }) {
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <img
        src={url}
        alt={name}
        className="max-w-none origin-center shadow-lg"
        style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none' }}
      />
    </div>
  );
}

export function AttachmentViewer({ refs, startAt, onClose }: {
  refs: AttachmentRef[];
  startAt: number;
  onClose: () => void;
}) {
  const { actions } = useKeeper();
  const [index, setIndex] = useState(startAt);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const current = refs[index];

  useEffect(() => {
    let cancelled = false;
    setBlob(null);
    setError(null);
    setZoom(1);
    if (!current) return;

    void actions
      .readAttachment(current)
      .then((result) => !cancelled && setBlob(result))
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Falha ao abrir o anexo.');
      });

    return () => {
      cancelled = true;
    };
  }, [actions, current]);

  // Object URLs keep the decrypted bytes alive in the browser; revoke each one
  // as soon as the viewer moves on, so locking the vault really does end access.
  const imageUrl = useMemo(() => (blob && current && !isPdf(current) ? URL.createObjectURL(blob) : null), [blob, current]);
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  const move = useCallback(
    (delta: number) => setIndex((value) => Math.min(Math.max(value + delta, 0), refs.length - 1)),
    [refs.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight') move(1);
      else if (event.key === 'ArrowLeft') move(-1);
      else if (event.key === '+' || event.key === '=') setZoom((value) => nextZoom(value, 1));
      else if (event.key === '-') setZoom((value) => nextZoom(value, -1));
      else if (event.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, onClose]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/85 backdrop-blur-sm" role="dialog" aria-modal="true">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-2.5 text-sm text-white">
        <Icon name={isPdf(current) ? 'file' : 'idCard'} size={16} />
        <span className="min-w-0 flex-1 truncate" title={current.name}>
          {current.name}
        </span>
        <span className="text-xs text-white/50">{formatBytes(current.size)}</span>

        {refs.length > 1 ? (
          <span className="flex items-center gap-1">
            <IconButton
              icon="chevron"
              label="Anexo anterior"
              className="rotate-180 text-white/70 hover:bg-white/10 hover:text-white"
              disabled={index === 0}
              onClick={() => move(-1)}
            />
            <span className="text-xs tabular-nums text-white/60">
              {index + 1} / {refs.length}
            </span>
            <IconButton
              icon="chevron"
              label="Próximo anexo"
              className="text-white/70 hover:bg-white/10 hover:text-white"
              disabled={index === refs.length - 1}
              onClick={() => move(1)}
            />
          </span>
        ) : null}

        <span className="flex items-center gap-1">
          <IconButton
            icon="zoomOut"
            label="Diminuir zoom"
            className="text-white/70 hover:bg-white/10 hover:text-white"
            onClick={() => setZoom((value) => nextZoom(value, -1))}
          />
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-w-14 rounded-lg px-2 py-1 text-xs tabular-nums text-white/70 hover:bg-white/10 hover:text-white"
            title="Zoom original"
          >
            {Math.round(zoom * 100)}%
          </button>
          <IconButton
            icon="zoomIn"
            label="Aumentar zoom"
            className="text-white/70 hover:bg-white/10 hover:text-white"
            onClick={() => setZoom((value) => nextZoom(value, 1))}
          />
        </span>

        <IconButton
          icon="x"
          label="Fechar visualizador"
          className="text-white/70 hover:bg-white/10 hover:text-white"
          onClick={onClose}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <p className="p-8 text-center text-sm text-danger">{error}</p>
        ) : !blob ? (
          <p className="flex items-center justify-center gap-2 p-8 text-sm text-white/70">
            <Spinner /> Decifrando…
          </p>
        ) : isPdf(current) ? (
          <PdfView blob={blob} zoom={zoom} />
        ) : imageUrl ? (
          <ImageView url={imageUrl} name={current.name} zoom={zoom} />
        ) : null}
      </div>
    </div>
  );
}
