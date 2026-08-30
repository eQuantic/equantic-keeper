import { describe, expect, it } from 'vitest';
import { clearDerivedKey, loadDerivedKey, saveDerivedKey } from './keystore';

/**
 * The node test environment has no IndexedDB, which doubles as the
 * private-window case: every call must degrade to a no-op instead of
 * throwing, leaving the password prompt as the fallback.
 */
describe('keystore without IndexedDB', () => {
  it('loads nothing', async () => {
    await expect(loadDerivedKey()).resolves.toBeNull();
  });

  it('saves and clears without throwing', async () => {
    await expect(saveDerivedKey({} as never, null)).resolves.toBeUndefined();
    await expect(saveDerivedKey({} as never, Date.now() + 60_000)).resolves.toBeUndefined();
    await expect(clearDerivedKey()).resolves.toBeUndefined();
  });
});
