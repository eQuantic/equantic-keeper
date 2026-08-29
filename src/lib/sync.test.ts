import { describe, expect, it } from 'vitest';
import { MIN_ITERATIONS, type DerivedKey } from './crypto';
import type { DriveApi, DriveFileMeta, RemoteVault } from './drive';
import { VAULT_FILE_NAME } from './drive';
import type { VaultItem } from './model';
import { createVault, emptyPayload, openVault, sealVault, type VaultFile, type VaultPayload } from './vault';
import { VaultPasswordMismatchError, pullVault, syncVault } from './sync';

const iterations = MIN_ITERATIONS;

/**
 * In-memory stand-in for Drive. It stores real ciphertext produced by the real
 * crypto, so these tests exercise the whole seal/merge/open path — only the
 * network is faked.
 */
class FakeDrive implements DriveApi {
  private files = new Map<string, { name: string; file: VaultFile; revision: number }>();
  private nextId = 1;

  readonly calls = { create: 0, update: 0, download: 0, rotateBackups: 0 };
  /** Set to make the next `rotateBackups` fail, as a flaky snapshot would. */
  backupsFail = false;

  seed(file: VaultFile, name = VAULT_FILE_NAME): DriveFileMeta {
    const id = `file-${this.nextId++}`;
    this.files.set(id, { name, file, revision: 1 });
    return this.metaOf(id);
  }

  /** Simulates another device writing to the same vault file. */
  overwrite(fileId: string, file: VaultFile): void {
    const entry = this.files.get(fileId);
    if (!entry) throw new Error(`arquivo inexistente: ${fileId}`);
    this.files.set(fileId, { ...entry, file, revision: entry.revision + 1 });
  }

  stored(fileId: string): VaultFile {
    const entry = this.files.get(fileId);
    if (!entry) throw new Error(`arquivo inexistente: ${fileId}`);
    return entry.file;
  }

  private metaOf(id: string): DriveFileMeta {
    const entry = this.files.get(id)!;
    return {
      id,
      name: entry.name,
      modifiedTime: new Date(1_700_000_000_000 + entry.revision * 1000).toISOString(),
      headRevisionId: `rev-${entry.revision}`,
    };
  }

  async findVault(): Promise<DriveFileMeta | null> {
    for (const [id, entry] of this.files) if (entry.name === VAULT_FILE_NAME) return this.metaOf(id);
    return null;
  }

  async getMeta(fileId: string): Promise<DriveFileMeta> {
    if (!this.files.has(fileId)) throw new Error(`arquivo inexistente: ${fileId}`);
    return this.metaOf(fileId);
  }

  async download(fileId: string): Promise<VaultFile> {
    this.calls.download += 1;
    return this.stored(fileId);
  }

  async fetchVault(): Promise<RemoteVault | null> {
    const meta = await this.findVault();
    return meta ? { meta, file: await this.download(meta.id) } : null;
  }

  async create(name: string, file: VaultFile): Promise<DriveFileMeta> {
    this.calls.create += 1;
    return this.seed(file, name);
  }

  async update(fileId: string, file: VaultFile): Promise<DriveFileMeta> {
    this.calls.update += 1;
    this.overwrite(fileId, file);
    return this.metaOf(fileId);
  }

  async rotateBackups(): Promise<void> {
    this.calls.rotateBackups += 1;
    if (this.backupsFail) throw new Error('cota do Drive excedida');
  }
}

function item(id: string, name: string, minutesAgo: number): VaultItem {
  const stamp = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  return {
    id,
    type: 'api-token',
    name,
    description: '',
    folder: '',
    holderId: '',
    tags: [],
    fields: { token: `token-${id}` },
    customFields: [],
    attachments: [],
    favorite: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function payloadWith(...items: VaultItem[]): VaultPayload {
  return { ...emptyPayload(), items };
}

async function setup(password = 'senha-mestra-de-teste') {
  const { derived } = await createVault(password, emptyPayload(), iterations);
  return { derived, drive: new FakeDrive() };
}

/** Decrypts whatever the fake Drive currently holds, to assert on real content. */
async function readStored(drive: FakeDrive, fileId: string, derived: DerivedKey): Promise<VaultPayload> {
  return openVault(drive.stored(fileId), derived);
}

describe('syncVault', () => {
  it('creates the vault file when Drive has none', async () => {
    const { derived, drive } = await setup();
    const local = payloadWith(item('a', 'GitHub PAT', 1));

    const result = await syncVault({ drive, derived }, local);

    expect(drive.calls.create).toBe(1);
    expect(drive.calls.update).toBe(0);
    expect(result.merged).toBe(false);
    expect(await readStored(drive, result.driveFileId, derived)).toMatchObject({
      items: [{ id: 'a', name: 'GitHub PAT' }],
    });
  });

  it('pushes without downloading when the remote revision is the one we know', async () => {
    const { derived, drive } = await setup();
    const meta = drive.seed(await sealVault(derived, emptyPayload()));

    const result = await syncVault(
      { drive, derived, driveFileId: meta.id, knownRevision: meta.headRevisionId },
      payloadWith(item('a', 'novo', 1)),
    );

    // Nothing changed remotely, so there is nothing to merge and nothing to read.
    expect(drive.calls.download).toBe(0);
    expect(result.merged).toBe(false);
    expect(drive.calls.update).toBe(1);
  });

  it('merges when the remote moved on, keeping items from both devices', async () => {
    const { derived, drive } = await setup();
    const meta = drive.seed(await sealVault(derived, payloadWith(item('remoto', 'do outro aparelho', 5))));

    const result = await syncVault(
      // A stale revision is what tells us another device wrote in the meantime.
      { drive, derived, driveFileId: meta.id, knownRevision: 'rev-obsoleta' },
      payloadWith(item('local', 'deste aparelho', 1)),
    );

    expect(result.merged).toBe(true);
    expect(drive.calls.download).toBe(1);
    expect(result.payload.items.map((entry) => entry.id).sort()).toEqual(['local', 'remoto']);
    // The merged state is what got written back, not just what we returned.
    const stored = await readStored(drive, result.driveFileId, derived);
    expect(stored.items.map((entry) => entry.id).sort()).toEqual(['local', 'remoto']);
  });

  it('keeps the most recent version of an item edited on both sides', async () => {
    const { derived, drive } = await setup();
    const meta = drive.seed(await sealVault(derived, payloadWith(item('a', 'versão antiga', 60))));

    const result = await syncVault(
      { drive, derived, driveFileId: meta.id, knownRevision: 'rev-obsoleta' },
      payloadWith(item('a', 'versão nova', 1)),
    );

    expect(result.payload.items).toHaveLength(1);
    expect(result.payload.items[0]?.name).toBe('versão nova');
  });

  it('refuses to merge a vault encrypted with a different master password', async () => {
    const { derived, drive } = await setup('senha-deste-aparelho');
    const other = await createVault('senha-do-outro-aparelho', payloadWith(item('x', 'alheio', 1)), iterations);
    const meta = drive.seed(other.file);

    await expect(
      syncVault({ drive, derived, driveFileId: meta.id, knownRevision: 'rev-obsoleta' }, emptyPayload()),
    ).rejects.toBeInstanceOf(VaultPasswordMismatchError);

    // The remote copy must survive untouched so the user can still choose a side.
    expect(drive.calls.update).toBe(0);
    expect(drive.stored(meta.id)).toEqual(other.file);
  });

  it('overwrites the remote copy when forced, without merging', async () => {
    const { derived, drive } = await setup('minha-senha');
    const other = await createVault('outra-senha', payloadWith(item('x', 'alheio', 1)), iterations);
    const meta = drive.seed(other.file);

    const result = await syncVault(
      { drive, derived, driveFileId: meta.id, knownRevision: 'rev-obsoleta' },
      payloadWith(item('meu', 'sobrescreve', 1)),
      { force: true },
    );

    expect(result.merged).toBe(false);
    expect(drive.calls.download).toBe(0);
    expect((await readStored(drive, meta.id, derived)).items.map((entry) => entry.id)).toEqual(['meu']);
  });

  it('falls back to creating the file when the known id vanished from Drive', async () => {
    const { derived, drive } = await setup();

    const result = await syncVault({ drive, derived, driveFileId: 'apagado-em-outro-lugar' }, emptyPayload());

    expect(drive.calls.create).toBe(1);
    expect(result.driveFileId).not.toBe('apagado-em-outro-lugar');
  });

  it('still reports success when the backup snapshot fails', async () => {
    const { derived, drive } = await setup();
    drive.backupsFail = true;

    // Losing a snapshot must never cost the user their save.
    await expect(syncVault({ drive, derived }, payloadWith(item('a', 'importante', 1)))).resolves.toMatchObject({
      merged: false,
    });
    expect(drive.calls.rotateBackups).toBe(1);
  });

  it('writes ciphertext, never plaintext', async () => {
    const { derived, drive } = await setup();
    const result = await syncVault({ drive, derived }, payloadWith(item('a', 'GitHub PAT', 1)));

    const raw = JSON.stringify(drive.stored(result.driveFileId));
    expect(raw).not.toContain('GitHub PAT');
    expect(raw).not.toContain('token-a');
  });

  it('advances the revision it reports after each write', async () => {
    const { derived, drive } = await setup();
    const first = await syncVault({ drive, derived }, emptyPayload());
    const second = await syncVault(
      { drive, derived, driveFileId: first.driveFileId, knownRevision: first.revision },
      payloadWith(item('a', 'novo', 1)),
    );
    expect(second.revision).not.toBe(first.revision);
  });
});

describe('pullVault', () => {
  it('returns null when Drive has no vault yet', async () => {
    const { derived, drive } = await setup();
    await expect(pullVault({ drive, derived })).resolves.toBeNull();
  });

  it('decrypts the remote vault without writing anything back', async () => {
    const { derived, drive } = await setup();
    drive.seed(await sealVault(derived, payloadWith(item('a', 'remoto', 1))));

    const result = await pullVault({ drive, derived });

    expect(result?.payload.items[0]?.name).toBe('remoto');
    expect(drive.calls.update).toBe(0);
    expect(drive.calls.create).toBe(0);
  });

  it('rejects a remote vault under a different master password', async () => {
    const { derived, drive } = await setup('minha-senha');
    const other = await createVault('outra-senha', emptyPayload(), iterations);
    drive.seed(other.file);

    await expect(pullVault({ drive, derived })).rejects.toBeInstanceOf(VaultPasswordMismatchError);
  });
});
