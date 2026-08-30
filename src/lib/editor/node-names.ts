// The TipTap node names for our custom block nodes, kept in one place so the
// extensions, UniqueID config, and the block↔PM converters agree on the strings.

export const CODE_BLOCK_SHIKI = "codeBlockShiki";
export const CALLOUT = "callout";
export const TOGGLE = "toggle";
export const MERMAID = "mermaid";
export const EQUATION = "equation";
export const EMBED = "embed";
export const FILE_BLOCK = "fileBlock";
export const IMAGE = "image"; // the @tiptap/extension-image node name

/**
 * Every block-level node name that can bear a stable `id` (and therefore a
 * comment). Fed to UniqueID's `types` so each gets a persisted `id` attribute.
 */
export const ID_BEARING_NODES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "horizontalRule",
  "table",
  IMAGE,
  CODE_BLOCK_SHIKI,
  CALLOUT,
  TOGGLE,
  MERMAID,
  EQUATION,
  EMBED,
  FILE_BLOCK,
];
