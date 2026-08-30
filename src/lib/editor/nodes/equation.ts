import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { EQUATION } from "../node-names";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    equation: {
      setEquation: () => ReturnType;
    };
  }
}

/**
 * A KaTeX block equation — `latex` attr holds the source.
 *
 * Schema-only factory: the web app injects a React node-view; the API passes
 * none (it only needs the schema to build a ProseMirror document).
 */
export function createEquation(nodeView?: () => NodeViewRenderer): Node {
  return Node.create({
    name: EQUATION,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
      return {
        id: { default: null },
        latex: {
          default: "",
          parseHTML: (el) => el.getAttribute("data-latex") ?? "",
          renderHTML: (attrs) => ({ "data-latex": attrs.latex as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${EQUATION}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": EQUATION })];
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),

    addCommands() {
      return {
        setEquation:
          () =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { latex: "" } }),
      };
    },
  });
}
