import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { TOGGLE } from "../node-names";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType;
    };
  }
}

/**
 * A collapsible toggle that holds real nested blocks (the hard one). Its content
 * is `(heading|paragraph) block*`: the first child is the toggle's own text
 * line, every following child is a genuine nested block. The `open` attribute
 * drives whether the nested blocks (everything after the head) are shown — the
 * node-view collapses them via CSS so editor state is never mutated on render.
 *
 * Schema-only factory: the web app injects a React node-view; the API passes
 * none (it only needs the schema to build a ProseMirror document).
 */
export function createToggle(nodeView?: () => NodeViewRenderer): Node {
  return Node.create({
    name: TOGGLE,
    group: "block",
    content: "(heading|paragraph) block*",
    defining: true,

    addAttributes() {
      return {
        id: { default: null },
        open: {
          default: true,
          parseHTML: (el) => el.getAttribute("data-open") !== "false",
          renderHTML: (attrs) => ({ "data-open": attrs.open ? "true" : "false" }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${TOGGLE}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": TOGGLE }), 0];
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),

    addCommands() {
      return {
        setToggle:
          () =>
          ({ commands }) =>
            commands.insertContent({
              type: this.name,
              attrs: { open: true },
              content: [{ type: "paragraph" }, { type: "paragraph" }],
            }),
      };
    },
  });
}
