import { afterEach, describe, expect, it } from 'vitest';
import {
  createCustomType,
  getAllTypes,
  getType,
  registerCustomTypes,
  type CustomTypeDef,
} from './model';
import { activeCustomTypes, emptyPayload, mergePayloads, normalizePayload, TOMBSTONE_TTL_DAYS } from './vault';

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

function custom(id: string, updatedAt: string, extra: Partial<CustomTypeDef> = {}): CustomTypeDef {
  return {
    ...createCustomType(),
    id,
    label: `Tipo ${id}`,
    group: 'Espanha',
    fields: [{ id: 'c1', label: 'Número', kind: 'text' }],
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  };
}

afterEach(() => registerCustomTypes([]));

describe('custom-type registry', () => {
  it('resolves a registered type through the same getType path', () => {
    registerCustomTypes([custom('custom-a', daysAgo(1))]);
    const resolved = getType('custom-a');
    expect(resolved.label).toBe('Tipo custom-a');
    expect(resolved.category).toBe('doc');
    expect(resolved.fields[0]?.label).toBe('Número');
    expect(getAllTypes().some((type) => type.id === 'custom-a')).toBe(true);
  });

  it('a type whose group is Desenvolvimento lands in the dev category', () => {
    registerCustomTypes([custom('custom-dev', daysAgo(1), { group: 'Desenvolvimento' })]);
    expect(getType('custom-dev').category).toBe('dev');
  });

  it('tombstoned types fall back to the unknown-type rendering', () => {
    const deletedAt = daysAgo(1);
    registerCustomTypes([custom('custom-x', deletedAt, { deletedAt })]);
    expect(getType('custom-x').label).toBe('Outro');
    expect(getAllTypes().some((type) => type.id === 'custom-x')).toBe(false);
  });
});

describe('custom types in the payload', () => {
  it('normalizes junk, unknown kinds and a missing group', () => {
    const normalized = normalizePayload({
      ...emptyPayload(),
      customTypes: [
        {
          ...custom('custom-a', daysAgo(1)),
          group: '  ',
          fields: [{ id: 'c1', label: 'Campo', kind: 'tabela-magica' }, null, 'nada'],
        },
        { nope: true },
      ],
    });
    expect(normalized.customTypes).toHaveLength(1);
    expect(normalized.customTypes[0]?.group).toBe('Geral');
    expect(normalized.customTypes[0]?.fields).toHaveLength(1);
    expect(normalized.customTypes[0]?.fields[0]?.kind).toBe('text');
  });

  it('vaults older than v5 open with an empty list', () => {
    const legacy = { items: [], people: [], folders: [], preferences: emptyPayload().preferences };
    expect(normalizePayload(legacy).customTypes).toEqual([]);
  });

  it('merges by id with most-recent-wins and tombstones', () => {
    const fresh = daysAgo(1);
    const deletedAt = daysAgo(2);
    const local = {
      ...emptyPayload(),
      customTypes: [custom('custom-a', fresh, { label: 'Local' }), custom('custom-b', daysAgo(5))],
    };
    const remote = {
      ...emptyPayload(),
      customTypes: [custom('custom-a', daysAgo(4), { label: 'Remoto' }), custom('custom-b', deletedAt, { deletedAt })],
    };
    const merged = mergePayloads(local, remote);
    expect(merged.customTypes.find((entry) => entry.id === 'custom-a')?.label).toBe('Local');
    expect(merged.customTypes.find((entry) => entry.id === 'custom-b')?.deletedAt).toBe(deletedAt);
    expect(activeCustomTypes(merged.customTypes).map((entry) => entry.id)).toEqual(['custom-a']);
  });

  it('purges tombstones past retention', () => {
    const deletedAt = daysAgo(TOMBSTONE_TTL_DAYS + 1);
    const local = { ...emptyPayload(), customTypes: [custom('custom-old', deletedAt, { deletedAt })] };
    expect(mergePayloads(local, emptyPayload()).customTypes).toHaveLength(0);
  });
});
