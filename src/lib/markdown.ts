/**
 * A note as plain Markdown.
 *
 * Blocks are the vault's model, but Markdown is what leaves it: what goes into
 * an e-mail or a message has to be readable by whoever receives it, and what is
 * exported as a file has to open anywhere — Obsidian, a text editor, GitHub.
 *
 * Marks are ranges over the block's text, so emphasis is applied by walking the
 * string once and opening/closing delimiters at the boundaries; overlapping
 * ranges nest in the order they open, which is what Markdown can express.
 */
import type { Block } from './blocks';

interface Mark {
  type: string;
  from: number;
  to: number;
  href?: string;
}

const DELIMITERS: Record<string, string> = {
  bold: '**',
  italic: '_',
  strike: '~~',
  code: '`',
};

function readMarks(content: Record<string, unknown>): Mark[] {
  const raw = content.marks;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (mark): mark is Mark =>
        !!mark &&
        typeof mark === 'object' &&
        typeof (mark as Mark).type === 'string' &&
        typeof (mark as Mark).from === 'number' &&
        typeof (mark as Mark).to === 'number',
    )
    .slice()
    .sort((a, b) => a.from - b.from || b.to - a.to);
}

/** The block's text with its marks turned into Markdown delimiters. */
function inlineText(content: Record<string, unknown>): string {
  const text = typeof content.text === 'string' ? content.text : '';
  const marks = readMarks(content);
  if (!text || marks.length === 0) return text;

  let out = '';
  // A stack, so a link inside bold closes in the right order.
  const open: Mark[] = [];
  const closeDown = (position: number) => {
    while (open.length && (open[open.length - 1]?.to ?? 0) <= position) {
      const mark = open.pop()!;
      out += mark.type === 'link' ? `](${mark.href ?? ''})` : (DELIMITERS[mark.type] ?? '');
    }
  };

  for (let index = 0; index <= text.length; index += 1) {
    closeDown(index);
    if (index === text.length) break;
    for (const mark of marks) {
      if (mark.from !== index || open.includes(mark)) continue;
      if (mark.type === 'link') out += '[';
      else out += DELIMITERS[mark.type] ?? '';
      open.push(mark);
    }
    out += text[index];
  }
  return out;
}

const str = (content: Record<string, unknown>, key: string): string =>
  typeof content[key] === 'string' ? (content[key] as string) : '';

function blockToMarkdown(block: Block, depth: number, numbering: { index: number }): string[] {
  const pad = '  '.repeat(depth);
  const content = block.content ?? {};
  const text = inlineText(content);
  const lines: string[] = [];

  switch (block.blockType) {
    case 'HEADING_1':
      lines.push(`# ${text}`);
      break;
    case 'HEADING_2':
      lines.push(`## ${text}`);
      break;
    case 'HEADING_3':
      lines.push(`### ${text}`);
      break;
    case 'BULLET_ITEM':
      lines.push(`${pad}- ${text}`);
      break;
    case 'NUMBERED_ITEM':
      numbering.index += 1;
      lines.push(`${pad}${numbering.index}. ${text}`);
      break;
    case 'TODO':
      lines.push(`${pad}- [${content.checked === true ? 'x' : ' '}] ${text}`);
      break;
    case 'QUOTE':
      lines.push(`> ${text}`);
      break;
    case 'CODE':
      lines.push(`\`\`\`${str(content, 'language')}`, str(content, 'code'), '```');
      break;
    case 'MERMAID':
      lines.push('```mermaid', str(content, 'code'), '```');
      break;
    case 'EQUATION':
      lines.push('$$', str(content, 'latex'), '$$');
      break;
    case 'DIVIDER':
      lines.push('---');
      break;
    case 'CALLOUT':
      lines.push(`> ${str(content, 'icon') || '💡'} ${text}`);
      break;
    case 'TOGGLE':
      // No Markdown for a disclosure: the head line becomes a bold line and the
      // children follow it, which is what the reader needs anyway.
      lines.push(`**${text}**`);
      break;
    case 'IMAGE':
      lines.push(`![${str(content, 'alt')}](${str(content, 'url') || str(content, 'src')})`);
      break;
    case 'FILE':
      lines.push(`[${str(content, 'name') || 'arquivo'}](${str(content, 'url')})`);
      break;
    case 'EMBED':
      lines.push(str(content, 'url'));
      break;
    case 'TABLE': {
      const rows = Array.isArray(content.rows) ? (content.rows as unknown[]) : [];
      const cells = rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []));
      const [head, ...rest] = cells;
      if (head?.length) {
        lines.push(`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`);
        for (const row of rest) lines.push(`| ${row.join(' | ')} |`);
      }
      break;
    }
    default:
      if (text) lines.push(text);
  }

  // Numbering restarts whenever a list is interrupted by anything else.
  if (block.blockType !== 'NUMBERED_ITEM') numbering.index = 0;

  for (const child of block.children ?? []) {
    lines.push(...blockToMarkdown(child, depth + 1, { index: 0 }));
  }
  return lines;
}

const LIST_BLOCKS = new Set(['BULLET_ITEM', 'NUMBERED_ITEM', 'TODO']);

/** Blocks in, a Markdown document out. */
export function blocksToMarkdown(blocks: Block[] | undefined): string {
  if (!blocks?.length) return '';
  const numbering = { index: 0 };
  let out = '';
  let previousWasList = false;

  for (const block of blocks) {
    const lines = blockToMarkdown(block, 0, numbering);
    if (!lines.length) continue;
    const isList = LIST_BLOCKS.has(block.blockType);
    if (out) {
      // Consecutive list items are one list; everything else is separated by a
      // blank line, or a reader glues the paragraphs together.
      out += isList && previousWasList ? '\n' : '\n\n';
    }
    out += lines.join('\n');
    previousWasList = isList;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** A file name for the exported note: the title, safe on every filesystem. */
export function markdownFileName(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${base || 'nota'}.md`;
}
