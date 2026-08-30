/**
 * Derives a plain-text mirror from a rich description's editor blocks
 * (`SerializedBlock[]`), so `Item.description` stays searchable / previewable
 * while `descriptionBlocks` holds the source of truth. Best-effort + defensive:
 * the block JSON is opaque to the backend, so we read the known content keys and
 * recurse into children (toggles, lists).
 */
export function blocksToPlainText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const lines: string[] = [];

  const walk = (nodes: unknown[]): void => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as { content?: unknown; children?: unknown };
      const c = (n.content ?? {}) as Record<string, unknown>;

      // Text-bearing blocks (paragraph/heading/quote/list/todo/callout/toggle)
      // carry `text`; code carries `code`; equation carries `latex`.
      const text =
        typeof c.text === 'string'
          ? c.text
          : typeof c.code === 'string'
            ? c.code
            : typeof c.latex === 'string'
              ? c.latex
              : '';
      if (text) lines.push(text);

      // Tables: flatten each row (`string[][]`).
      if (Array.isArray(c.rows)) {
        for (const row of c.rows) {
          if (Array.isArray(row)) {
            lines.push(row.filter((x) => typeof x === 'string').join(' '));
          }
        }
      }

      if (Array.isArray(n.children)) walk(n.children);
    }
  };

  walk(blocks);
  return lines.join('\n').trim();
}
