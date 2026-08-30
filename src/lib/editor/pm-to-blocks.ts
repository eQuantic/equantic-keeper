// A ProseMirror/TipTap JSON document → the doc's block tree (SerializedBlock[]).
//
// Inverse of blocks-to-pm.ts. List/todo wrappers explode back into individual
// BULLET_ITEM/NUMBERED_ITEM/TODO blocks; TOGGLE's nested content becomes its
// `children`. Stable ids ride back out via each node's `id` attribute (kept in
// sync with the DocBlock id by UniqueID).

import type { JSONContent } from "@tiptap/core";
import { inlineToMarks } from "./marks";
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

/** The serialized shape `onChange` emits — a DocBlock minus server-owned fields. */
export interface SerializedBlock {
  id: string | null;
  blockType: string;
  content: Record<string, unknown>;
  children: SerializedBlock[];
}

const idOf = (n: JSONContent): string | null => {
  const id = n.attrs?.id;
  return typeof id === "string" ? id : null;
};

/** Pull `{ text, marks }` from a node's first paragraph (or its own inline content). */
function textContent(n: JSONContent): { text: string; marks: ReturnType<typeof inlineToMarks>["marks"] } {
  // A wrapper (listItem/blockquote/callout) holds a paragraph; unwrap one level.
  if (n.content?.length === 1 && n.content[0]?.type === "paragraph") {
    return inlineToMarks(n.content[0].content);
  }
  // blockquote may hold multiple paragraphs — join their text.
  if (n.type === "blockquote") {
    const joined = (n.content ?? []).flatMap((p) => p.content ?? []);
    return inlineToMarks(joined);
  }
  return inlineToMarks(n.content);
}

function headingType(level: number): string {
  if (level === 1) return "HEADING_1";
  if (level === 2) return "HEADING_2";
  return "HEADING_3";
}

function tableContent(n: JSONContent): Record<string, unknown> {
  const rows: string[][] = [];
  let hasHeader = false;
  for (const row of n.content ?? []) {
    const cells: string[] = [];
    for (const cell of row.content ?? []) {
      if (cell.type === "tableHeader") hasHeader = true;
      const text = (cell.content ?? [])
        .flatMap((p) => p.content ?? [])
        .filter((t) => t.type === "text")
        .map((t) => t.text ?? "")
        .join("");
      cells.push(text);
    }
    rows.push(cells);
  }
  return { rows: rows.length ? rows : [["", ""]], hasHeader };
}

/** Convert one PM node → one (or, for lists, several) SerializedBlock. */
function nodeToBlocks(n: JSONContent): SerializedBlock[] {
  const id = idOf(n);
  const block = (blockType: string, content: Record<string, unknown>, children: SerializedBlock[] = []): SerializedBlock => ({
    id,
    blockType,
    content,
    children,
  });

  switch (n.type) {
    case "paragraph": {
      const { text, marks } = inlineToMarks(n.content);
      return [block("PARAGRAPH", { text, marks })];
    }
    case "heading": {
      const { text, marks } = inlineToMarks(n.content);
      const level = typeof n.attrs?.level === "number" ? n.attrs.level : 1;
      return [block(headingType(level), { text, marks })];
    }
    case "blockquote": {
      const { text, marks } = textContent(n);
      return [block("QUOTE", { text, marks })];
    }
    case "bulletList":
      return (n.content ?? []).map((li) => {
        const { text, marks } = textContent(li);
        return { id: idOf(li), blockType: "BULLET_ITEM", content: { text, marks }, children: [] };
      });
    case "orderedList":
      return (n.content ?? []).map((li) => {
        const { text, marks } = textContent(li);
        return { id: idOf(li), blockType: "NUMBERED_ITEM", content: { text, marks }, children: [] };
      });
    case "taskList":
      return (n.content ?? []).map((ti) => {
        const { text, marks } = textContent(ti);
        return { id: idOf(ti), blockType: "TODO", content: { text, marks, checked: ti.attrs?.checked === true }, children: [] };
      });
    case "horizontalRule":
      return [block("DIVIDER", {})];
    case "table":
      return [block("TABLE", tableContent(n))];
    case CODE_BLOCK_SHIKI:
      return [block("CODE", { code: str(n, "code"), language: str(n, "language") || "plaintext" })];
    case MERMAID:
      return [block("MERMAID", { code: str(n, "code") })];
    case EQUATION:
      return [block("EQUATION", { latex: str(n, "latex") })];
    case EMBED:
      return [block("EMBED", { url: str(n, "url") })];
    case IMAGE:
      return [block("IMAGE", { url: str(n, "src"), alt: str(n, "alt") })];
    case FILE_BLOCK:
      return [block("FILE", { url: str(n, "url"), name: str(n, "name"), size: typeof n.attrs?.size === "number" ? n.attrs.size : 0 })];
    case CALLOUT: {
      const { text, marks } = textContent(n);
      return [block("CALLOUT", { text, marks, icon: str(n, "icon") || "💡" })];
    }
    case TOGGLE: {
      // content: '(heading|paragraph) block*' — head line first, rest are children.
      const [head, ...rest] = n.content ?? [];
      const headInline = head ? inlineToMarks(head.content) : { text: "", marks: [] };
      const children = rest.flatMap(nodeToBlocks);
      return [block("TOGGLE", { text: headInline.text, marks: headInline.marks, collapsed: n.attrs?.open === false }, children)];
    }
    default:
      return [];
  }
}

const str = (n: JSONContent, k: string): string =>
  typeof n.attrs?.[k] === "string" ? (n.attrs[k] as string) : "";

/** Top-level: a TipTap document JSON → the flat-with-children block tree. */
export function docToBlocks(doc: JSONContent): SerializedBlock[] {
  return (doc.content ?? []).flatMap(nodeToBlocks);
}
