import { describe, expect, it } from 'vitest';
import { DecryptionError, MIN_ITERATIONS } from './crypto';
import type { Person, VaultItem } from './model';
import {
  TOMBSTONE_TTL_DAYS,
  VAULT_VERSION,
  activeFolders,
  activePeople,
  WrongPasswordError,
  createVault,
  emptyPayload,
  isVaultFile,
  matchesKey,
  mergePayloads,
  normalizePayload,
  purgeTombstones,
  unlockVault,
} from './vault';

const iterations = MIN_ITERATIONS;

function item(id: string, updatedAt: string, extra: Partial<VaultItem> = {}): VaultItem {
  return {
    id,
    type: 'api-token',
    name: `item-${id}`,
    description: '',
    folder: '',
    holderId: '',
    tags: [],
    fields: {},
    customFields: [],
    attachments: [],
    favorite: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    ...extra,
  };
}

function person(id: string, updatedAt: string, extra: Partial<Person> = {}): Person {
  return {
    id,
    name: `pessoa-${id}`,
    relation: '',
    birthDate: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt,
    ...extra,
  };
}

describe('vault file', () => {
  it('encrypts the payload and round-trips it', async () => {
    const payload = { ...emptyPayload(), items: [item('a', '2026-02-01T00:00:00.000Z')] };
    payload.items[0]!.fields = { token: 'ghp_supersecret' };

    const { file } = await createVault('senha-mestra-forte', payload, iterations);
    expect(isVaultFile(file)).toBe(true);
    expect(JSON.stringify(file)).not.toContain('ghp_supersecret');

    const opened = await unlockVault(file, 'senha-mestra-forte');
    expect(opened.payload.items[0]?.fields.token).toBe('ghp_supersecret');
  });

  it('rejects the wrong master password before attempting to decrypt', async () => {
    const { file } = await createVault('certa', emptyPayload(), iterations);
    await expect(unlockVault(file, 'errada')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('refuses a vault written by a newer format version', async () => {
    const { file } = await createVault('senha', emptyPayload(), iterations);
    await expect(unlockVault({ ...file, version: 99 }, 'senha')).rejects.toThrow(/versão mais recente/i);
  });

  it('detects tampering with the public header', async () => {
    const { file } = await createVault('senha', emptyPayload(), iterations);

    // `iterations` feeds the derivation, so the verifier stops matching.
    await expect(
      unlockVault({ ...file, kdf: { ...file.kdf, iterations: file.kdf.iterations + 1 } }, 'senha'),
    ).rejects.toBeInstanceOf(WrongPasswordError);

    // `format` does not affect the derivation but is authenticated as AAD.
    await expect(
      unlockVault({ ...file, format: 'outro.formato' as typeof file.format }, 'senha'),
    ).rejects.toBeInstanceOf(DecryptionError);
  });

  it('recognises a file produced by the same key', async () => {
    const { derived, file } = await createVault('senha', emptyPayload(), iterations);
    expect(matchesKey(file, derived)).toBe(true);

    const other = await createVault('senha', emptyPayload(), iterations);
    expect(matchesKey(other.file, derived)).toBe(false); // different salt
  });
});

describe('normalizePayload', () => {
  it('fills in defaults and drops malformed items', () => {
    const payload = normalizePayload({ items: [{ id: 'ok' }, null, { name: 'sem id' }] });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({ id: 'ok', type: 'note', tags: [], favorite: false });
    expect(payload.preferences.autoLockMinutes).toBeGreaterThan(0);
  });

  /**
   * A vault written before v2 has no `people` and no `holderId`. Opening it
   * must not throw and must not leave `undefined` where the UI expects a
   * string, or the first render of the holder filter would crash.
   */
  it('abre um cofre v1, sem pessoas nem titular', () => {
    const payload = normalizePayload({
      items: [{ id: 'antigo', type: 'api-token', name: 'PAT', fields: { token: 'x' } }],
      preferences: { theme: 'light' },
    });
    expect(payload.people).toEqual([]);
    expect(payload.items[0]?.holderId).toBe('');
    expect(payload.preferences.theme).toBe('light');
  });

  /** Um cofre v2 tem pessoas mas nenhum anexo; a lista precisa nascer vazia. */
  it('abre um cofre v2, sem anexos nos itens', () => {
    const payload = normalizePayload({
      items: [{ id: 'doc', type: 'pt-residencia', name: 'Título', holderId: 'p1' }],
      people: [{ id: 'p1', name: 'Maria' }],
    });
    expect(payload.items[0]?.attachments).toEqual([]);
    expect(payload.people[0]?.name).toBe('Maria');
  });

  it('descarta anexo sem chave, que seria indecifrável', () => {
    const bom = {
      id: 'a1',
      name: 'scan.pdf',
      mimeType: 'application/pdf',
      size: 10,
      iv: 'aXY=',
      wrapped: { key: 'aw==', iv: 'aXY=' },
      driveFileId: '',
      addedAt: '2026-08-01T00:00:00.000Z',
    };
    const payload = normalizePayload({
      items: [{ id: 'doc', attachments: [bom, { id: 'a2', iv: 'aXY=' }, null, 'nada'] }],
    });
    expect(payload.items[0]?.attachments.map((entry) => entry.id)).toEqual(['a1']);
  });

  it('descarta pessoas malformadas e completa as que faltam campos', () => {
    const payload = normalizePayload({ people: [{ id: 'p1' }, null, { name: 'sem id' }] });
    expect(payload.people).toHaveLength(1);
    expect(payload.people[0]).toMatchObject({ id: 'p1', name: '', relation: '', birthDate: '' });
  });

  it('preserva a lápide de uma pessoa removida', () => {
    const deletedAt = '2026-05-01T00:00:00.000Z';
    const payload = normalizePayload({ people: [{ id: 'p1', name: 'ex', deletedAt }] });
    expect(payload.people[0]?.deletedAt).toBe(deletedAt);
    expect(activePeople(payload.people)).toEqual([]);
  });
});

describe('versão do formato', () => {
  it('grava a versão corrente e recusa uma mais nova', async () => {
    const { file } = await createVault('senha', emptyPayload(), iterations);
    expect(file.version).toBe(VAULT_VERSION);
    await expect(unlockVault({ ...file, version: VAULT_VERSION + 1 }, 'senha')).rejects.toThrow(
      /versão mais recente/i,
    );
  });

  it('leva as pessoas junto no ciclo cifra/decifra', async () => {
    const payload = { ...emptyPayload(), people: [person('p1', '2026-02-01T00:00:00.000Z', { name: 'Maria' })] };
    const { file } = await createVault('senha', payload, iterations);
    expect(JSON.stringify(file)).not.toContain('Maria');

    const opened = await unlockVault(file, 'senha');
    expect(opened.payload.people[0]?.name).toBe('Maria');
  });
});

describe('mergePayloads', () => {
  const base = emptyPayload();
  // Relative timestamps: absolute dates would eventually drift past the
  // tombstone retention window and purge the very items under test.
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  it('keeps items that exist on only one side', () => {
    const local = { ...base, items: [item('a', daysAgo(5))] };
    const remote = { ...base, items: [item('b', daysAgo(4))] };
    const merged = mergePayloads(local, remote);
    expect(merged.items.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('resolves conflicts with the most recent update', () => {
    const local = { ...base, items: [item('a', daysAgo(1), { name: 'local' })] };
    const remote = { ...base, items: [item('a', daysAgo(30), { name: 'remoto' })] };
    expect(mergePayloads(local, remote).items[0]?.name).toBe('local');
    expect(mergePayloads(remote, local).items[0]?.name).toBe('local');
  });

  it('propagates deletions instead of resurrecting items', () => {
    const deletedAt = daysAgo(2);
    const local = { ...base, items: [item('a', daysAgo(10))] };
    const remote = { ...base, items: [item('a', deletedAt, { deletedAt })] };
    expect(mergePayloads(local, remote).items[0]?.deletedAt).toBe(deletedAt);
  });

  it('drops deletions older than the retention window', () => {
    const deletedAt = daysAgo(TOMBSTONE_TTL_DAYS + 1);
    const local = { ...base, items: [item('a', daysAgo(TOMBSTONE_TTL_DAYS + 5))] };
    const remote = { ...base, items: [item('a', deletedAt, { deletedAt })] };
    expect(mergePayloads(local, remote).items).toHaveLength(0);
  });

  it('lets a later edit win over an older deletion', () => {
    const local = { ...base, items: [item('a', daysAgo(1), { name: 'revivido' })] };
    const remote = { ...base, items: [item('a', daysAgo(3), { deletedAt: daysAgo(3) })] };
    const merged = mergePayloads(local, remote);
    expect(merged.items[0]?.deletedAt).toBeUndefined();
    expect(merged.items[0]?.name).toBe('revivido');
  });

  it('reúne as pessoas dos dois aparelhos', () => {
    const local = { ...base, people: [person('p1', daysAgo(3))] };
    const remote = { ...base, people: [person('p2', daysAgo(2))] };
    expect(mergePayloads(local, remote).people.map((entry) => entry.id).sort()).toEqual(['p1', 'p2']);
  });

  it('mantém a edição mais recente do nome de uma pessoa', () => {
    const local = { ...base, people: [person('p1', daysAgo(1), { name: 'Maria Silva' })] };
    const remote = { ...base, people: [person('p1', daysAgo(9), { name: 'Maria' })] };
    expect(mergePayloads(local, remote).people[0]?.name).toBe('Maria Silva');
    expect(mergePayloads(remote, local).people[0]?.name).toBe('Maria Silva');
  });

  /**
   * A lápide precisa sobreviver à mesclagem: se a pessoa sumisse do payload, o
   * próximo aparelho a sincronizar devolveria o nome apagado.
   */
  it('propaga a remoção de uma pessoa sem ressuscitá-la', () => {
    const deletedAt = daysAgo(2);
    const local = { ...base, people: [person('p1', daysAgo(10))] };
    const remote = { ...base, people: [person('p1', deletedAt, { deletedAt })] };
    const merged = mergePayloads(local, remote);
    expect(merged.people[0]?.deletedAt).toBe(deletedAt);
    expect(activePeople(merged.people)).toEqual([]);
  });

  it('esquece a lápide de uma pessoa depois do prazo de retenção', () => {
    const deletedAt = daysAgo(TOMBSTONE_TTL_DAYS + 1);
    const local = { ...base, people: [person('p1', daysAgo(TOMBSTONE_TTL_DAYS + 5))] };
    const remote = { ...base, people: [person('p1', deletedAt, { deletedAt })] };
    expect(mergePayloads(local, remote).people).toHaveLength(0);
  });

  it('takes preferences from the side with the newer activity', () => {
    const local = {
      items: [item('a', daysAgo(1))],
      people: [],
      folders: [],
      preferences: { ...base.preferences, autoLockMinutes: 1 },
    };
    const remote = {
      items: [item('b', daysAgo(20))],
      people: [],
      folders: [],
      preferences: { ...base.preferences, autoLockMinutes: 60 },
    };
    expect(mergePayloads(local, remote).preferences.autoLockMinutes).toBe(1);
  });
});

describe('purgeTombstones', () => {
  it('drops tombstones past the retention window and keeps fresh ones', () => {
    const now = Date.parse('2026-08-01T00:00:00.000Z');
    const old = new Date(now - (TOMBSTONE_TTL_DAYS + 1) * 86_400_000).toISOString();
    const recent = new Date(now - 86_400_000).toISOString();
    const kept = purgeTombstones(
      [
        item('old', old, { deletedAt: old }),
        item('recent', recent, { deletedAt: recent }),
        item('alive', recent),
      ],
      now,
    );
    expect(kept.map((entry) => entry.id)).toEqual(['recent', 'alive']);
  });
});

describe('folders in the payload', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const folder = (name: string, updatedAt: string, extra: Partial<import('./model').Folder> = {}) => ({
    name,
    createdAt: updatedAt,
    updatedAt,
    ...extra,
  });

  it('normalizes junk out and keeps the freshest duplicate of a name', () => {
    // Timestamps are pinned once: daysAgo() re-called in the assertion can
    // land 1ms later and flake.
    const fresh = daysAgo(1);
    const raw = {
      ...emptyPayload(),
      folders: [
        folder('Fiscal', daysAgo(5)),
        folder('Fiscal', fresh),
        folder('  ', fresh),
        { nope: true },
        folder('  Infra ', daysAgo(2)),
      ],
    };
    const normalized = normalizePayload(raw);
    expect(normalized.folders.map((entry) => entry.name).sort()).toEqual(['Fiscal', 'Infra']);
    expect(normalized.folders.find((entry) => entry.name === 'Fiscal')?.updatedAt).toBe(fresh);
  });

  it('vaults without the field still open', () => {
    const legacy = { items: [], people: [], preferences: emptyPayload().preferences };
    expect(normalizePayload(legacy).folders).toEqual([]);
  });

  it('merges by name with most-recent-wins', () => {
    const fresh = daysAgo(1);
    const local = { ...emptyPayload(), folders: [folder('Fiscal', fresh)] };
    const remote = { ...emptyPayload(), folders: [folder('Fiscal', daysAgo(3)), folder('Clientes', daysAgo(2))] };
    const merged = mergePayloads(local, remote);
    expect(merged.folders.map((entry) => entry.name).sort()).toEqual(['Clientes', 'Fiscal']);
    expect(merged.folders.find((entry) => entry.name === 'Fiscal')?.updatedAt).toBe(fresh);
  });

  it('a newer tombstone deletes across devices; activeFolders hides it', () => {
    const deletedAt = daysAgo(1);
    const local = { ...emptyPayload(), folders: [folder('Fiscal', daysAgo(4))] };
    const remote = { ...emptyPayload(), folders: [folder('Fiscal', deletedAt, { deletedAt })] };
    const merged = mergePayloads(local, remote);
    expect(merged.folders).toHaveLength(1);
    expect(merged.folders[0]?.deletedAt).toBe(deletedAt);
    expect(activeFolders(merged.folders)).toHaveLength(0);
  });

  it('a tombstone past retention is purged from the payload', () => {
    const deletedAt = daysAgo(TOMBSTONE_TTL_DAYS + 1);
    const local = { ...emptyPayload(), folders: [folder('Fiscal', deletedAt, { deletedAt })] };
    expect(mergePayloads(local, emptyPayload()).folders).toHaveLength(0);
  });
});
