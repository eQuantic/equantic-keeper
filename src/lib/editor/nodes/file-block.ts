import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { FILE_BLOCK } from "../node-names";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileBlock: {
      setFileBlock: () => ReturnType;
    };
  }
}

/**
 * An attached file rendered as a download card — `{ url, name, size }` attrs.
 *
 * Schema-only factory: the web app injects a React node-view; the API passes
 * none (it only needs the schema to build a ProseMirror document).
 */
export function createFileBlock(nodeView?: () => NodeViewRenderer): Node {
  return Node.create({
    name: FILE_BLOCK,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
      return {
        id: { default: null },
        url: {
          default: "",
          parseHTML: (el) => el.getAttribute("href") ?? "",
          renderHTML: (attrs) => ({ href: attrs.url as string }),
        },
        name: {
          default: "",
          parseHTML: (el) => el.getAttribute("data-name") ?? "",
          renderHTML: (attrs) => ({ "data-name": attrs.name as string }),
        },
        size: {
          default: 0,
          parseHTML: (el) => Number(el.getAttribute("data-size") ?? 0),
          renderHTML: (attrs) => ({ "data-size": String(attrs.size ?? 0) }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `a[data-type="${FILE_BLOCK}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["a", mergeAttributes(HTMLAttributes, { "data-type": FILE_BLOCK })];
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),

    addCommands() {
      return {
        setFileBlock:
          () =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { url: "", name: "", size: 0 } }),
      };
    },
  });
}
