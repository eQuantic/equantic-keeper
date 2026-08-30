import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { CODE_BLOCK_SHIKI } from "../node-names";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    codeBlockShiki: {
      setCodeBlockShiki: () => ReturnType;
    };
  }
}

/**
 * A Shiki-highlighted code block. The code text lives in a `code` attribute
 * (not PM content), matching the existing `{ code, language }` block model — the
 * node is an atom whose node-view owns editing + async highlight.
 *
 * Schema-only factory: the web app injects a React node-view; the API passes
 * none (it only needs the schema to build a ProseMirror document).
 */
export function createCodeBlockShiki(nodeView?: () => NodeViewRenderer): Node {
  return Node.create({
    name: CODE_BLOCK_SHIKI,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
      return {
        id: { default: null },
        code: {
          default: "",
          parseHTML: (el) => el.textContent ?? "",
          renderHTML: () => ({}),
        },
        language: {
          default: "plaintext",
          parseHTML: (el) => el.getAttribute("data-language") ?? "plaintext",
          renderHTML: (attrs) => ({ "data-language": attrs.language as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `pre[data-type="${CODE_BLOCK_SHIKI}"]` }];
    },

    renderHTML({ HTMLAttributes, node }) {
      return [
        "pre",
        mergeAttributes(HTMLAttributes, { "data-type": CODE_BLOCK_SHIKI }),
        ["code", {}, (node.attrs.code as string) ?? ""],
      ];
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),

    addCommands() {
      return {
        setCodeBlockShiki:
          () =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { code: "", language: "plaintext" } }),
      };
    },
  });
}
