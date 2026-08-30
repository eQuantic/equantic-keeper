import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { EMBED } from "../node-names";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embed: {
      setEmbed: () => ReturnType;
    };
  }
}

/**
 * An embedded URL (YouTube/Vimeo/Figma/Loom…) — `url` attr drives the iframe.
 *
 * Schema-only factory: the web app injects a React node-view; the API passes
 * none (it only needs the schema to build a ProseMirror document).
 */
export function createEmbed(nodeView?: () => NodeViewRenderer): Node {
  return Node.create({
    name: EMBED,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,

    addAttributes() {
      return {
        id: { default: null },
        url: {
          default: "",
          parseHTML: (el) => el.getAttribute("data-url") ?? "",
          renderHTML: (attrs) => ({ "data-url": attrs.url as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${EMBED}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": EMBED })];
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),

    addCommands() {
      return {
        setEmbed:
          () =>
          ({ commands }) =>
            commands.insertContent({ type: this.name, attrs: { url: "" } }),
      };
    },
  });
}
