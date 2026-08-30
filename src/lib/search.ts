/** Filtering and ranking for the item list. */
import { DEFAULT_WARNING_DAYS, expiryOf } from './expiry';
import { getFamily, getType, isSecretKind, type VaultItem } from './model';
import { originByCode } from './documents';
import { isWithinFolder } from './folders';
import { blocksToPlainText } from './blocks';

export interface Filters {
  query: string;
  type: string | null;
  tag: string | null;
  folder: string | null;
  /** `Person.id`, or null for "anyone". */
  holderId: string | null;
  /** One family of near-identical paperwork, e.g. every declaration. */
  family: string | null;
  /** Issuing country, as a DOCUMENT_ORIGINS/ISO code. */
  country: string | null;
  /** Restricts the list to one part of the catalogue. */
  category: 'dev' | 'doc' | 'note' | null;
  /** Only what is past its validity date, or approaching it. */
  expiry: 'expired' | 'soon' | null;
  favoritesOnly: boolean;
  view: 'active' | 'trash';
}

export const EMPTY_FILTERS: Filters = {
  query: '',
  type: null,
  tag: null,
  folder: null,
  holderId: null,
  family: null,
  country: null,
  category: null,
  expiry: null,
  favoritesOnly: false,
  view: 'active',
};

export type SortMode = 'updated' | 'name' | 'created' | 'type';

/** Lowercase and strip accents: "residencia" must find "residência". */
export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

/**
 * Haystack for an item. Secret values are deliberately excluded: a search
 * should never surface a token because the user typed part of it.
 */
function haystack(item: VaultItem, holderName = ''): string {
  const type = getType(item.type);
  const parts = [
    item.name,
    item.description,
    item.folder,
    type.label,
    type.group,
    // "declarações" must reach every one of them, whatever its own label says.
    getFamily(type.family)?.label ?? '',
    // A passport issued in Brazil answers to "brasil" even though its type is generic.
    originByCode(item.country)?.group ?? '',
    // A note is found by what is written in it, block by block.
    item.blocks ? blocksToPlainText(item.blocks) : '',
    holderName,
    ...item.tags,
    // Aliases: "holerite" must find a recibo de vencimento, "nato vivo" the
    // nascido vivo declaration, "carteira de motorista" every country's licence.
    ...(type.keywords ?? []),
  ];
  for (const field of type.fields) {
    if (!isSecretKind(field.kind)) {
      const value = item.fields[field.id];
      if (value) parts.push(value);
    }
  }
  for (const custom of item.customFields) {
    parts.push(custom.label);
    if (!custom.secret) parts.push(custom.value);
  }
  return normalizeSearchText(parts.join(' '));
}

export function matches(item: VaultItem, query: string, holderName = ''): boolean {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = haystack(item, holderName);
  return terms.every((term) => hay.includes(term));
}

export function scoreItem(item: VaultItem, query: string): number {
  if (!query) return 0;
  const name = normalizeSearchText(item.name);
  const q = normalizeSearchText(query);
  if (name === q) return 100;
  if (name.startsWith(q)) return 80;
  if (name.includes(q)) return 60;
  if (item.tags.some((tag) => normalizeSearchText(tag).includes(q))) return 40;
  return 10;
}

export function applyFilters(
  items: VaultItem[],
  filters: Filters,
  sort: SortMode,
  /** `Person.id` -> name, so the holder is searchable by name. */
  holderNames: Map<string, string> = new Map(),
  /** Window used by the expiry filter; ignored when that filter is off. */
  warningDays = DEFAULT_WARNING_DAYS,
): VaultItem[] {
  const wantTrash = filters.view === 'trash';
  const filtered = items.filter((item) => {
    if (wantTrash !== !!item.deletedAt) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.family && getType(item.type).family !== filters.family) return false;
    if (filters.country && item.country !== filters.country) return false;
    if (filters.category && getType(item.type).category !== filters.category) return false;
    if (filters.holderId && item.holderId !== filters.holderId) return false;
    if (filters.tag && !item.tags.includes(filters.tag)) return false;
    if (filters.folder && !isWithinFolder(item.folder, filters.folder)) return false;
    if (filters.favoritesOnly && !item.favorite) return false;
    if (filters.expiry && expiryOf(item, warningDays)?.status !== filters.expiry) return false;
    return matches(item, filters.query, holderNames.get(item.holderId) ?? '');
  });

  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
  return filtered.sort((a, b) => {
    if (filters.query) {
      const delta = scoreItem(b, filters.query) - scoreItem(a, filters.query);
      if (delta !== 0) return delta;
    }
    switch (sort) {
      case 'name':
        return collator.compare(a.name, b.name);
      case 'created':
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      case 'type':
        return (
          collator.compare(getType(a.type).label, getType(b.type).label) || collator.compare(a.name, b.name)
        );
      case 'updated':
      default:
        return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    }
  });
}

export function collectTags(items: VaultItem[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.deletedAt) continue;
    for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pt-BR'));
}

export function collectFolders(items: VaultItem[]): { folder: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.deletedAt || !item.folder) continue;
    counts.set(item.folder, (counts.get(item.folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => a.folder.localeCompare(b.folder, 'pt-BR'));
}
