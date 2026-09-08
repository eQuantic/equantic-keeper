import { describe, expect, it } from 'vitest';

import { driveUsage, type DriveFileMeta } from './drive';
import type { StoredFileMeta, VaultStorage } from './storage-provider';

/**
 * A provider that is not Google, built by hand. It exists to prove that
 * counting what a vault occupies asks nothing of Drive in particular: the two
 * methods below are the whole contract, and a second provider that answers them
 * gets the same numbers.
 */
function providerWith(
  files: StoredFileMeta[],
  quota: { used: number; limit: number } | null = null,
): VaultStorage {
  const provider: Partial<VaultStorage> = {
    label: 'Provedor de teste',
    listAll: async () => files,
    storageQuota: async () => quota,
    shares: false,
  };
  // Only the two methods above are reachable from here; anything else this
  // test touched by accident would throw rather than pass quietly.
  return new Proxy(provider as VaultStorage, {
    get(target, property) {
      if (property in target) return target[property as keyof VaultStorage];
      throw new Error(`driveUsage não deveria chamar ${String(property)}`);
    },
  });
}

describe('espaço ocupado no Drive', () => {
  const files: DriveFileMeta[] = [
    { id: '1', name: 'vault.keeper.json', modifiedTime: '', size: '4096' },
    { id: '2', name: 'backup-2026-08-30.json', modifiedTime: '', size: '4000' },
    { id: '3', name: 'backup-2026-08-29.json', modifiedTime: '', size: '3800' },
    { id: '4', name: 'attachment-abc.bin', modifiedTime: '', size: '1048576' },
    { id: '5', name: 'attachment-def.bin', modifiedTime: '', size: '2097152' },
    { id: '6', name: 'estranho.txt', modifiedTime: '', size: '10' },
    { id: '7', name: 'sem-tamanho', modifiedTime: '' },
  ];

  it('separa cofre, backups e anexos, e soma tudo', async () => {
    const usage = await driveUsage(providerWith(files));
    expect(usage).toMatchObject({
      vault: 4096,
      backups: 7800,
      attachments: 3145728,
      other: 10,
      files: 7,
      total: 4096 + 7800 + 3145728 + 10,
    });
  });

  it('inclui a cota da conta quando o Drive a informa', async () => {
    const usage = await driveUsage(providerWith(files, { used: 5_000_000, limit: 15_000_000_000 }));
    expect(usage.quota).toEqual({ used: 5_000_000, limit: 15_000_000_000 });
    // Uma recusa é silenciosa: a cota é contexto, não a resposta.
    expect((await driveUsage(providerWith(files))).quota).toBeUndefined();
  });
});
