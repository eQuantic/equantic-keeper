import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { MERMAID } from "../node-names";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaid: {
      setMermaid: () => ReturnType;
    };
  }
}

/**
 * A Mermaid diagram — `code` attr holds the source; node-view renders the svg.
 *
 * Schema-only factory: the web app injects a React node-view; the API passes
 * none (it only needs the schema to build a ProseMirror document).
 */
export function createMermaid(nodeView?: () => NodeViewRenderer): Node {
  return Node.create({
    name: MERMAID,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
      return {
        id: { default: null },
        code: {
          default: "",
          parseHTML: (el) => el.getAttribute("data-code") ?? "",
          renderHTML: (attrs) => ({ "data-code": attrs.code as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${MERMAID}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": MERMAID })];
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),

    addCommands() {
      return {
        setMermaid:
          () =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { code: "" } }),
      };
    },
  });
}
