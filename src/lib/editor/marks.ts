// Mark conversion between the doc's `{ text, marks }` content model and TipTap's
// inline JSON (an array of text nodes, each carrying its active marks).
//
// The block model stores marks as ranges `{ type, from, to, href? }` (see
// rich-text.ts). TipTap stores them inline per text segment. These pure helpers
// bridge the two directions so blocks↔PM conversion round-trips losslessly.

import type { JSONContent } from "@tiptap/core";
import { contentMarks, contentText, type Mark, type MarkType } from "./rich-text";

/** TipTap mark name → our MarkType (and back). Underline isn't in the block model. */
const PM_MARK_NAME: Record<MarkType, string> = {
  bold: "bold",
  italic: "italic",
  code: "code",
  strike: "strike",
  link: "link",
};
const NAME_MARK: Record<string, MarkType> = {
  bold: "bold",
  italic: "italic",
  code: "code",
  strike: "strike",
  link: "link",
};

/** `{ text, marks }` → TipTap inline content (text nodes split at mark boundaries). */
export function marksToInline(text: string, marks: Mark[]): JSONContent[] {
  if (!text) return [];
  const points = new Set<number>([0, text.length]);
  for (const m of marks) {
    points.add(Math.max(0, Math.min(text.length, m.from)));
    points.add(Math.max(0, Math.min(text.length, m.to)));
  }
  const bounds = [...points].sort((a, b) => a - b);
  const out: JSONContent[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const a = bounds[i];
    const b = bounds[i + 1];
    if (a === undefined || b === undefined || a >= b) continue;
    const seg = text.slice(a, b);
    const active = marks.filter((m) => m.from <= a && m.to >= b);
    const pmMarks = active.map((m) =>
      m.type === "link"
        ? { type: "link", attrs: { href: m.href ?? "#" } }
        : { type: PM_MARK_NAME[m.type] },
    );
    out.push(pmMarks.length ? { type: "text", text: seg, marks: pmMarks } : { type: "text", text: seg });
  }
  return out;
}

/** Read `{ text, marks }` from a block's content and produce TipTap inline content. */
export function contentToInline(content: Record<string, unknown> | null | undefined): JSONContent[] {
  return marksToInline(contentText(content), contentMarks(content));
}

interface PmMark {
  type?: string;
  attrs?: { href?: string } | null;
}

/** TipTap inline content (an array of text nodes / hard breaks) → `{ text, marks }`. */
export function inlineToMarks(content: JSONContent[] | undefined): { text: string; marks: Mark[] } {
  let text = "";
  const marks: Mark[] = [];
  for (const node of content ?? []) {
    if (node.type === "hardBreak") {
      text += "\n";
      continue;
    }
    if (node.type !== "text" || typeof node.text !== "string") continue;
    const from = text.length;
    text += node.text;
    const to = text.length;
    for (const raw of (node.marks ?? []) as PmMark[]) {
      const type = raw.type ? NAME_MARK[raw.type] : undefined;
      if (!type) continue;
      if (type === "link") marks.push({ type, from, to, href: raw.attrs?.href ?? "#" });
      else marks.push({ type, from, to });
    }
  }
  return { text, marks: mergeMarks(marks) };
}

/** Merge adjacent/overlapping marks of the same type (and href, for links). */
function mergeMarks(marks: Mark[]): Mark[] {
  const sorted = [...marks].sort((x, y) =>
    x.type === y.type ? x.from - y.from : x.type.localeCompare(y.type),
  );
  const out: Mark[] = [];
  for (const m of sorted) {
    if (m.from >= m.to) continue;
    const last = out[out.length - 1];
    if (last && last.type === m.type && last.href === m.href && m.from <= last.to) {
      last.to = Math.max(last.to, m.to);
    } else {
      out.push({ ...m });
    }
  }
  return out;
}
