// The pure inline rich-text model shared by the block↔ProseMirror converters.
//
// A text block's content is `{ text, marks }`, where `marks` is a list of
// `{ type, from, to, href? }` ranges. This module is the framework-agnostic
// subset of the web app's docs/rich-text.ts: just the mark types and the
// content readers that `marks.ts` (and therefore blocks-to-pm / pm-to-blocks)
// depend on. The DOM-bound helpers (renderHtml/serialize/selection/toggleMark)
// stay in the web app — they are not needed to build the schema.

export type MarkType = "bold" | "italic" | "code" | "strike" | "link";

export interface Mark {
  type: MarkType;
  from: number;
  to: number;
  href?: string;
}

/** Read `{ text, marks }` from a content object, tolerating missing/invalid shapes. */
export function contentText(content: Record<string, unknown> | null | undefined): string {
  return typeof content?.text === "string" ? content.text : "";
}

export function contentMarks(content: Record<string, unknown> | null | undefined): Mark[] {
  const raw = content?.marks;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is Mark =>
      !!m && typeof m === "object" && typeof (m as Mark).type === "string" &&
      typeof (m as Mark).from === "number" && typeof (m as Mark).to === "number",
  );
}
