// The single source of truth for the Docs editor's extension list — the schema
// the web editor renders AND the schema the API uses to build ProseMirror
// documents for server-side Yjs seeding.
//
// Every custom node is a schema-only factory that takes an optional node-view.
// The web app passes its React node-views; the API passes none (schema-only).

import { Node, type Extensions, type NodeViewRenderer } from "@tiptap/core";
// Named import (not default): the default-export CJS interop breaks when this
// package is bundled to CJS and consumed by the NestJS API — `StarterKit.default`
// ends up undefined, so `buildDocExtensions()` threw on the server and Yjs
// seeding (onLoadDocument) silently failed, so docs never persisted.
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { UniqueID } from "@tiptap/extension-unique-id";
import { ID_BEARING_NODES } from "./node-names";
import { createImageBlock } from "./nodes/image-block";
import { createCodeBlockShiki } from "./nodes/code-block-shiki";
import { createCallout } from "./nodes/callout";
import { createToggle } from "./nodes/toggle";
import { createMermaid } from "./nodes/mermaid";
import { createEquation } from "./nodes/equation";
import { createEmbed } from "./nodes/embed";
import { createFileBlock } from "./nodes/file-block";

/** Each custom node may receive a node-view factory; omit one for schema-only use. */
type NodeViewMap = Partial<
  Record<
    "imageBlock" | "codeBlockShiki" | "callout" | "toggle" | "mermaid" | "equation" | "embed" | "fileBlock",
    () => NodeViewRenderer
  >
>;

export interface DocExtensionOptions {
  /** React node-views, keyed by node. The API leaves these unset (schema-only). */
  nodeViews?: NodeViewMap;
  /** Keep StarterKit's undo/redo. Default true; pass false for Yjs collab. */
  history?: boolean;
}

/** Web Crypto's randomUUID — available as a global in browsers and Node 19+. */
const getCrypto = (): { randomUUID: () => string } =>
  (globalThis as unknown as { crypto: { randomUUID: () => string } }).crypto;

/**
 * Build the full, ordered Docs extension list. The order matches the original
 * web editor exactly so the produced schema is identical on both sides.
 */
export function buildDocExtensions(opts: DocExtensionOptions = {}): Extensions {
  const nv = opts.nodeViews ?? {};
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: false, // replaced by the custom Shiki code block
      link: { openOnClick: false },
      ...(opts.history === false ? { undoRedo: false } : {}),
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    createImageBlock(nv.imageBlock),
    createCodeBlockShiki(nv.codeBlockShiki),
    createCallout(nv.callout),
    createToggle(nv.toggle),
    createMermaid(nv.mermaid),
    createEquation(nv.equation),
    createEmbed(nv.embed),
    createFileBlock(nv.fileBlock),
    UniqueID.configure({
      types: ID_BEARING_NODES,
      attributeName: "id",
      generateID: () => getCrypto().randomUUID(),
    }),
  ];
}

// Re-exported so a schema-only consumer (the API) can refer to the Node type.
export { Node };
