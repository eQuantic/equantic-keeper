// TipTap command type augmentations for the web editor UI.
//
// The Docs *schema* now lives in @equantic-space/docs-editor-core, which imports
// the TipTap extension packages internally. But TipTap registers each command's
// type (e.g. `setLink`, `insertTable`, `toggleBold`) by augmenting
// `@tiptap/core`'s `Commands` interface from *inside* the extension package —
// and those `declare module` augmentations only merge into a program that
// imports the extension package directly. Since the schema package's bundled
// d.ts no longer re-exposes them, the web UI (bubble-toolbar, slash-items) would
// otherwise not see these commands as typed.
//
// Re-importing the extension packages here (the web app already depends on them)
// pulls their `@tiptap/core` augmentations back into the web TypeScript program.
// `import type` keeps this types-only — it adds no runtime import and no bundle
// weight; the actual extension instances are still created inside
// buildDocExtensions().

import type {} from "@tiptap/starter-kit";
import type {} from "@tiptap/extension-list";
import type {} from "@tiptap/extension-table";
import type {} from "@tiptap/extension-image";
import type {} from "@tiptap/extension-link";
