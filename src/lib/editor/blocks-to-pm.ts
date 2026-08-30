// DocBlock tree → a ProseMirror/TipTap JSON document.
//
// This is the load-bearing migration helper (Phase B/Yjs reuses it). Each block
// maps to a PM node carrying its DocBlock `id` (so UniqueID keeps the stable id
// === the block id). Consecutive list/todo items collapse into the single list
// wrapper ProseMirror requires; TOGGLE recurses into its children.

import type { JSONContent } from "@tiptap/core";
import { contentToInline } from "./marks";
import {
  CALLOUT,
  CODE_BLOCK_SHIKI,
  EMBED,
  EQUATION,
  FILE_BLOCK,
  IMAGE,
  MERMAID,
  TOGGLE,
} from "./node-names";

/**
 * The minimal block shape the converter reads — structurally compatible with the
 * web app's `DocBlockDto` and the API's persisted block rows, so neither side has
 * to depend on the other. `content` is free-form JSON per block type.
 */
export interface DocBlockInput {
  id: string;
  blockType: string;
  content: Record<string, unknown> | null;
  parentBlockId: string | null;
  position: string | number;
  children?: DocBlockInput[];
}

const str = (b: DocBlockInput, k: string): string =>
  typeof b.content?.[k] === "string" ? (b.content[k] as string) : "";
const num = (b: DocBlockInput, k: string): number =>
  typeof b.content?.[k] === "number" ? (b.content[k] as number) : 0;

/** A heading-or-paragraph node holding a block's inline `{ text, marks }`. */
function textNode(b: DocBlockInput): JSONContent {
  const inline = contentToInline(b.content);
  const base = { attrs: { id: b.id } as Record<string, unknown>, content: inline };
  switch (b.blockType) {
    case "HEADING_1":
      return { type: "heading", attrs: { id: b.id, level: 1 }, content: inline };
    case "HEADING_2":
      return { type: "heading", attrs: { id: b.id, level: 2 }, content: inline };
    case "HEADING_3":
      return { type: "heading", attrs: { id: b.id, level: 3 }, content: inline };
    case "QUOTE":
      return { type: "blockquote", attrs: { id: b.id }, content: [{ type: "paragraph", content: inline }] };
    default:
      return { type: "paragraph", ...base };
  }
}

/** A single list item wrapping the block's text (used inside list/todo wrappers). */
function listItemNode(b: DocBlockInput): JSONContent {
  return {
    type: "listItem",
    attrs: { id: b.id },
    content: [{ type: "paragraph", content: contentToInline(b.content) }],
  };
}
function taskItemNode(b: DocBlockInput): JSONContent {
  return {
    type: "taskItem",
    attrs: { id: b.id, checked: b.content?.checked === true },
    content: [{ type: "paragraph", content: contentToInline(b.content) }],
  };
}

function tableNode(b: DocBlockInput): JSONContent {
  const rows: string[][] = Array.isArray(b.content?.rows)
    ? (b.content.rows as string[][])
    : [["", ""], ["", ""]];
  const hasHeader = b.content?.hasHeader !== false;
  return {
    type: "table",
    attrs: { id: b.id },
    content: rows.map((row, r) => ({
      type: "tableRow",
      content: row.map((cell) => ({
        type: hasHeader && r === 0 ? "tableHeader" : "tableCell",
        content: [{ type: "paragraph", content: cell ? [{ type: "text", text: cell }] : [] }],
      })),
    })),
  };
}

/** A custom/atom block (code/mermaid/equation/embed/image/file/callout/divider). */
function customNode(b: DocBlockInput): JSONContent | null {
  switch (b.blockType) {
    case "DIVIDER":
      return { type: "horizontalRule", attrs: { id: b.id } };
    case "CODE":
      return { type: CODE_BLOCK_SHIKI, attrs: { id: b.id, language: str(b, "language") || "plaintext", code: str(b, "code") } };
    case "MERMAID":
      return { type: MERMAID, attrs: { id: b.id, code: str(b, "code") } };
    case "EQUATION":
      return { type: EQUATION, attrs: { id: b.id, latex: str(b, "latex") } };
    case "EMBED":
      return { type: EMBED, attrs: { id: b.id, url: str(b, "url") } };
    case "IMAGE":
      return { type: IMAGE, attrs: { id: b.id, src: str(b, "url") || null, alt: str(b, "alt") || null } };
    case "FILE":
      return { type: FILE_BLOCK, attrs: { id: b.id, url: str(b, "url"), name: str(b, "name"), size: num(b, "size") } };
    case "CALLOUT":
      return { type: CALLOUT, attrs: { id: b.id, icon: str(b, "icon") || "💡" }, content: [{ type: "paragraph", content: contentToInline(b.content) }] };
    default:
      return null;
  }
}

/** A TOGGLE → a `toggle` node: its own text line + its children as nested blocks. */
function toggleNode(b: DocBlockInput): JSONContent {
  const head: JSONContent = { type: "paragraph", content: contentToInline(b.content) };
  const children = blocksToContent(b.children ?? []);
  return {
    type: TOGGLE,
    attrs: { id: b.id, open: b.content?.collapsed !== true },
    // content: '(heading|paragraph) block*' — the head line, then nested blocks.
    content: children.length ? [head, ...children] : [head, { type: "paragraph" }],
  };
}

const LIST_TYPE: Record<string, "bulletList" | "orderedList"> = {
  BULLET_ITEM: "bulletList",
  NUMBERED_ITEM: "orderedList",
};

/** Convert a flat list of sibling blocks → PM content, grouping runs of items. */
export function blocksToContent(blocks: DocBlockInput[]): JSONContent[] {
  const out: JSONContent[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (!b) break;

    // Group a run of same-family list items into one wrapper node.
    const listType = LIST_TYPE[b.blockType];
    if (listType) {
      const items: JSONContent[] = [];
      for (let next = blocks[i]; next && next.blockType === b.blockType; next = blocks[i]) {
        items.push(listItemNode(next));
        i += 1;
      }
      out.push({ type: listType, content: items });
      continue;
    }
    if (b.blockType === "TODO") {
      const items: JSONContent[] = [];
      for (let next = blocks[i]; next && next.blockType === "TODO"; next = blocks[i]) {
        items.push(taskItemNode(next));
        i += 1;
      }
      out.push({ type: "taskList", content: items });
      continue;
    }

    if (b.blockType === "TOGGLE") out.push(toggleNode(b));
    else if (b.blockType === "TABLE") out.push(tableNode(b));
    else {
      const custom = customNode(b);
      out.push(custom ?? textNode(b));
    }
    i += 1;
  }
  return out;
}

/** Top-level: a doc's block tree → a complete TipTap document JSON. */
export function blocksToDoc(blocks: DocBlockInput[]): JSONContent {
  const content = blocksToContent(blocks);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}
