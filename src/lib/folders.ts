/**
 * Folders are paths, not records with parents: an item carries one string,
 * "Documentos/Portugal/2026", and the tree is derived from it.
 *
 * The alternative — folder ids with a parent pointer — would mean migrating
 * every item, teaching merge about a second entity and inventing a repair for
 * orphaned children when two devices delete and move the same folder. A path
 * keeps the item's field exactly as it always was (older vaults are already
 * valid single-segment paths), keeps last-writer-wins working unchanged, and
 * makes moving a subtree a prefix rewrite.
 */

export const FOLDER_SEPARATOR = '/';

/** Trims each segment and drops the empty ones: " a / / b " → "a/b". */
export function normalizeFolderPath(raw: string): string {
  return raw
    .split(FOLDER_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(FOLDER_SEPARATOR);
}

export function folderSegments(path: string): string[] {
  return normalizeFolderPath(path).split(FOLDER_SEPARATOR).filter(Boolean);
}

/** The name shown in the tree: the last segment. */
export function folderLeaf(path: string): string {
  const segments = folderSegments(path);
  return segments[segments.length - 1] ?? '';
}

/** The path above, or '' when the folder already sits at the root. */
export function folderParent(path: string): string {
  const segments = folderSegments(path);
  return segments.slice(0, -1).join(FOLDER_SEPARATOR);
}

/** Every ancestor of a path, root first — "a/b/c" → ["a", "a/b"]. */
export function folderAncestors(path: string): string[] {
  const segments = folderSegments(path);
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join(FOLDER_SEPARATOR));
}

/** True for the folder itself and for anything under it. */
export function isWithinFolder(candidate: string, ancestor: string): boolean {
  if (!ancestor) return true;
  const path = normalizeFolderPath(candidate);
  const root = normalizeFolderPath(ancestor);
  return path === root || path.startsWith(`${root}${FOLDER_SEPARATOR}`);
}

/** A strict descendant — used to refuse dropping a folder inside itself. */
export function isDescendantFolder(candidate: string, ancestor: string): boolean {
  return candidate !== ancestor && isWithinFolder(candidate, ancestor);
}

/**
 * The path a folder takes when moved under `nextParent` ('' means the root),
 * keeping its own name.
 */
export function movedFolderPath(path: string, nextParent: string): string {
  const leaf = folderLeaf(path);
  const parent = normalizeFolderPath(nextParent);
  return parent ? `${parent}${FOLDER_SEPARATOR}${leaf}` : leaf;
}

/** Rewrites a path that lives at or under `from` so it lives under `to`. */
export function rewriteFolderPath(path: string, from: string, to: string): string {
  if (!isWithinFolder(path, from)) return path;
  const rest = normalizeFolderPath(path).slice(normalizeFolderPath(from).length);
  return `${to}${rest}`;
}

export interface FolderNode {
  path: string;
  name: string;
  depth: number;
  /** Items filed directly in this folder. */
  count: number;
  /** Items in this folder and everything under it. */
  total: number;
  children: FolderNode[];
}

/**
 * The tree behind a flat set of paths. Intermediate folders that nobody
 * created explicitly still appear: an item filed in "A/B" makes "A" a real
 * place in the sidebar, or its children would be unreachable.
 */
export function buildFolderTree(paths: Iterable<string>, counts: Map<string, number>): FolderNode[] {
  const roots: FolderNode[] = [];
  const index = new Map<string, FolderNode>();
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });

  const ensure = (path: string, depth: number): FolderNode => {
    const existing = index.get(path);
    if (existing) return existing;
    const node: FolderNode = {
      path,
      name: folderLeaf(path),
      depth,
      count: counts.get(path) ?? 0,
      total: 0,
      children: [],
    };
    index.set(path, node);
    const parent = folderParent(path);
    if (parent) ensure(parent, depth - 1).children.push(node);
    else roots.push(node);
    return node;
  };

  for (const raw of paths) {
    const path = normalizeFolderPath(raw);
    if (!path) continue;
    ensure(path, folderSegments(path).length - 1);
  }

  const totalOf = (node: FolderNode): number => {
    node.children.sort((a, b) => collator.compare(a.name, b.name));
    node.total = node.count + node.children.reduce((sum, child) => sum + totalOf(child), 0);
    return node.total;
  };
  roots.sort((a, b) => collator.compare(a.name, b.name));
  for (const root of roots) totalOf(root);
  return roots;
}

/** The tree flattened for rendering, skipping anything under a collapsed folder. */
export function flattenFolderTree(nodes: FolderNode[], expanded: ReadonlySet<string>): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (list: FolderNode[]) => {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0 && expanded.has(node.path)) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
