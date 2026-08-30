import { mergeAttributes, Node, type NodeViewRenderer } from "@tiptap/core";
import { CALLOUT } from "../node-names";

export interface CalloutAttrs {
  id: string | null;
  icon: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: () => ReturnType;
    };
  }
}

/**
 * A coloured note holding inline content, with an editable leading emoji.
 *
 * Schema-only factory: the web app injects a React node-view; the API passes
 * none (it only needs the schema to build a ProseMirror document).
 */
export function createCallout(nodeView?: () => NodeViewRenderer): Node {
  return Node.create({
    name: CALLOUT,
    group: "block",
    content: "paragraph",
    defining: true,

    addAttributes() {
      return {
        id: { default: null },
        icon: {
          default: "💡",
          parseHTML: (el) => el.getAttribute("data-icon") ?? "💡",
          renderHTML: (attrs) => ({ "data-icon": attrs.icon as string }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-type="${CALLOUT}"]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": CALLOUT }), 0];
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),

    addCommands() {
      return {
        setCallout:
          () =>
          ({ commands }) =>
            commands.setNode(this.name, { icon: "💡" }),
      };
    },
  });
}
