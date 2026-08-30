import type { Node, NodeViewRenderer } from "@tiptap/core";
// Named import (not default) — the default-export CJS interop breaks in the
// API's bundled-CJS consumption (see extensions.ts).
import { Image } from "@tiptap/extension-image";

/**
 * The built-in Image node, extended with a stable `id` attribute (so the node
 * can bear a comment / round-trip its id) and made draggable. The web app injects
 * a React node-view that shows the URL-input / upload empty-state when `src` is
 * empty; the API passes none (it only needs the schema).
 */
export function createImageBlock(nodeView?: () => NodeViewRenderer): Node {
  return Image.extend({
    draggable: true,

    addAttributes() {
      return {
        ...this.parent?.(),
        id: { default: null },
      };
    },

    ...(nodeView ? { addNodeView: () => nodeView() } : {}),
  });
}
