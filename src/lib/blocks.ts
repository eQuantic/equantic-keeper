/**
 * The note's content model: an ordered tree of typed blocks, exactly the shape
 * eQuantic Space stores for its docs (`SerializedBlock`), so the two products
 * speak one language and a note can move between them without a converter.
 *
 * The vault stores BLOCKS, not the editor's ProseMirror JSON: blocks are the
 * durable model (they outlive the editor library), and the ported converters
 * in `lib/editor` turn them into a document and back on every open and save.
 *
 * Everything read from a vault is untrusted — another device, an imported
 * backup, a future version of this app — so `normalizeBlocks` rebuilds the tree
 * from scratch, keeping only what it recognises.
 */
import type { SerializedBlock } from './editor/pm-to-blocks';
import type { DocBlockInput } from './editor/blocks-to-pm';

export type Block = SerializedBlock;

export { blocksToPlainText } from './editor/blocks-to-plain-text';

/** Every block type the editor can produce (the enum Space persists). */
export const BLOCK_TYPES = [
  'PARAGRAPH',
  'HEADING_1',
  'HEADING_2',
  'HEADING_3',
  'BULLET_ITEM',
  'NUMBERED_ITEM',
  'TODO',
  'QUOTE',
  'CODE',
  'DIVIDER',
  'CALLOUT',
  'TOGGLE',
  'IMAGE',
  'FILE',
  'EMBED',
  'TABLE',
  'MERMAID',
  'EQUATION',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

const TYPE_SET = new Set<string>(BLOCK_TYPES);

/** Depth guard: a hand-edited vault must not be able to blow the stack. */
const MAX_DEPTH = 12;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Marks are ranges over the block's text. A mark pointing outside the text (or
 * backwards) would make the editor throw on load, so they are clamped here.
 */
function normalizeMarks(raw: unknown, textLength: number): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const marks: Record<string, unknown>[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const { type, from, to, href } = entry;
    if (typeof type !== 'string' || typeof from !== 'number' || typeof to !== 'number') continue;
    const start = Math.max(0, Math.min(Math.floor(from), textLength));
    const end = Math.max(start, Math.min(Math.floor(to), textLength));
    if (end === start) continue;
    marks.push({ type, from: start, to: end, ...(typeof href === 'string' ? { href } : {}) });
  }
  return marks;
}

function normalizeContent(raw: unknown): Record<string, unknown> {
  if (!isPlainObject(raw)) return {};
  const content: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'marks') continue;
    // Only JSON-ish leaves: a block's content is data, never a function or a
    // nested surprise from an imported file.
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      content[key] = value;
    } else if (Array.isArray(value)) {
      content[key] = value.map((row) =>
        Array.isArray(row) ? row.filter((cell) => typeof cell === 'string') : String(row ?? ''),
      );
    }
  }
  const text = typeof content.text === 'string' ? content.text : '';
  const marks = normalizeMarks(raw.marks, text.length);
  if (marks.length) content.marks = marks;
  return content;
}

export function normalizeBlocks(raw: unknown, depth = 0): Block[] {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return [];
  const blocks: Block[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue;
    const blockType = typeof entry.blockType === 'string' ? entry.blockType : '';
    if (!TYPE_SET.has(blockType)) continue;
    blocks.push({
      id: typeof entry.id === 'string' ? entry.id : null,
      blockType,
      content: normalizeContent(entry.content),
      children: normalizeBlocks(entry.children, depth + 1),
    });
  }
  return blocks;
}

/** An empty note is one empty paragraph — what the editor opens with. */
export function isEmptyBlocks(blocks: Block[] | undefined): boolean {
  if (!blocks || blocks.length === 0) return true;
  return blocks.every(
    (block) =>
      block.blockType === 'PARAGRAPH' &&
      block.children.length === 0 &&
      !String(block.content.text ?? '').trim(),
  );
}

/**
 * The converters were written against Space's persisted rows, where the server
 * owns the id and a fractional `position` among siblings. A vault has no server:
 * the array order IS the position, and an id is minted for a block that has
 * none (a note written on a device before ids, or imported from elsewhere).
 */
export function toEditorInput(blocks: Block[]): DocBlockInput[] {
  return blocks.map((block, index) => ({
    id: block.id ?? crypto.randomUUID(),
    blockType: block.blockType,
    content: block.content,
    parentBlockId: null,
    position: index,
    children: toEditorInput(block.children),
  }));
}

export interface OutlineEntry {
  /** The block's id — the editor stamps the same value on the DOM node. */
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

/** The note's headings, in order: what the summary column lists. */
export function noteOutline(blocks: Block[] | undefined): OutlineEntry[] {
  const levels: Record<string, 1 | 2 | 3> = { HEADING_1: 1, HEADING_2: 2, HEADING_3: 3 };
  const out: OutlineEntry[] = [];
  const walk = (nodes: Block[]) => {
    for (const node of nodes) {
      const level = levels[node.blockType];
      const text = String(node.content.text ?? '').trim();
      if (level && node.id && text) out.push({ id: node.id, level, text });
      walk(node.children);
    }
  };
  walk(blocks ?? []);
  return out;
}

export interface NoteStats {
  blocks: number;
  todos: number;
  done: number;
}

/** What the summary column says under the headings. */
export function noteStats(blocks: Block[] | undefined): NoteStats {
  const stats: NoteStats = { blocks: 0, todos: 0, done: 0 };
  const walk = (nodes: Block[]) => {
    for (const node of nodes) {
      stats.blocks += 1;
      if (node.blockType === 'TODO') {
        stats.todos += 1;
        if (node.content.checked === true) stats.done += 1;
      }
      walk(node.children);
    }
  };
  walk(blocks ?? []);
  return stats;
}
