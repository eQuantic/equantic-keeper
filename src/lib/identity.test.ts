import { describe, expect, it } from 'vitest';
import { clearIdentity, ensureIdentity, loadIdentity } from './identity';
import { fingerprint } from './invites';

/**
 * The node test environment has no IndexedDB, which doubles as the private-window
 * case: the keypair still has to exist for the session, and the caller has to be
 * told it was not written down — a code sent to someone that dies on reload is a
 * trap, not a feature.
 */
describe('identidade sem IndexedDB', () => {
  it('não carrega nada', async () => {
    await expect(loadIdentity()).resolves.toBeNull();
  });

  it('ainda entrega um par de chaves, avisando que não ficou guardado', async () => {
    const { identity, persisted } = await ensureIdentity();

    expect(persisted).toBe(false);
    expect(identity.privateKey.extractable).toBe(false);
    expect((await fingerprint(identity.publicKey)).length).toBe(16);
  });

  it('limpar não estoura', async () => {
    await expect(clearIdentity()).resolves.toBeUndefined();
  });
});
