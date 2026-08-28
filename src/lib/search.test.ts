import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, applyFilters, collectFolders, collectTags, matches } from './search';
import { createItem, type VaultItem } from './model';

function make(overrides: Partial<VaultItem>): VaultItem {
  return { ...createItem('api-token'), name: 'sem nome', ...overrides };
}

const items: VaultItem[] = [
  make({
    id: '1',
    name: 'GitHub PAT — Produção',
    folder: 'Infra',
    tags: ['ci', 'github'],
    fields: { service: 'GitHub', token: 'ghp_supersecret', username: 'edgar' },
  }),
  make({
    id: '2',
    type: 'registry',
    name: 'Azure Container Registry',
    folder: 'Infra',
    tags: ['azure'],
    favorite: true,
    fields: { registry: 'equantic.azurecr.io', password: 'acr-token-value' },
  }),
  make({ id: '3', name: 'Nota antiga', type: 'note', deletedAt: '2026-01-01T00:00:00.000Z' }),
];

describe('matches', () => {
  it('finds items by name regardless of accents and case', () => {
    expect(matches(items[0]!, 'producao')).toBe(true);
    expect(matches(items[0]!, 'GITHUB pat')).toBe(true);
  });

  it('requires every term to be present', () => {
    expect(matches(items[0]!, 'github infra')).toBe(true);
    expect(matches(items[0]!, 'github azure')).toBe(false);
  });

  it('searches non-secret fields but never secret values', () => {
    expect(matches(items[1]!, 'azurecr.io')).toBe(true);
    expect(matches(items[0]!, 'ghp_supersecret')).toBe(false);
    expect(matches(items[1]!, 'acr-token-value')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(matches(items[0]!, '   ')).toBe(true);
  });
});

describe('applyFilters', () => {
  it('hides trashed items from the active view and vice versa', () => {
    expect(applyFilters(items, EMPTY_FILTERS, 'name').map((item) => item.id)).toEqual(['2', '1']);
    expect(applyFilters(items, { ...EMPTY_FILTERS, view: 'trash' }, 'name').map((item) => item.id)).toEqual(['3']);
  });

  it('filters by type, tag, folder and favourites', () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, type: 'registry' }, 'name')).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, tag: 'ci' }, 'name')).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, folder: 'Infra' }, 'name')).toHaveLength(2);
    expect(applyFilters(items, { ...EMPTY_FILTERS, favoritesOnly: true }, 'name')).toHaveLength(1);
  });

  it('ranks exact name matches first', () => {
    const extra = make({ id: '4', name: 'GitHub PAT — Produção (antigo)' });
    const ranked = applyFilters([extra, ...items], { ...EMPTY_FILTERS, query: 'GitHub PAT — Produção' }, 'name');
    expect(ranked[0]?.id).toBe('1');
  });
});

describe('collectTags / collectFolders', () => {
  it('counts only active items', () => {
    expect(collectTags(items).map((entry) => entry.tag).sort()).toEqual(['azure', 'ci', 'github']);
    expect(collectFolders(items)).toEqual([{ folder: 'Infra', count: 2 }]);
  });
});
