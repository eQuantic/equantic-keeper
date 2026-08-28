import { describe, expect, it } from 'vitest';
import { DecryptionError, MIN_ITERATIONS } from './crypto';
import type { VaultItem } from './model';
import {
  TOMBSTONE_TTL_DAYS,
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
    tags: [],
    fields: {},
    customFields: [],
    favorite: false,
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

  it('takes preferences from the side with the newer activity', () => {
    const local = {
      items: [item('a', daysAgo(1))],
      preferences: { ...base.preferences, autoLockMinutes: 1 },
    };
    const remote = {
      items: [item('b', daysAgo(20))],
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
