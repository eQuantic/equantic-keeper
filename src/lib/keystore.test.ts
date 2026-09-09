import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDerivedKey, loadDerivedKey, saveDerivedKey } from './keystore';
import type { DerivedKey } from './crypto';

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

/**
 * IndexedDB, as far as this file uses it — plus one switch the real thing does
 * not have: a delete that never commits. That is precisely what a page being
 * torn down does to a transaction in flight, and it is the situation this
 * module now has to survive.
 */
function stubIndexedDB(seed: Record<string, unknown> = {}) {
  const rows = new Map<string, unknown>(Object.entries(seed));
  let swallowDeletes = false;

  const fire = <T>(produce: () => T) => {
    const request: { result?: T; onsuccess: (() => void) | null; onerror: (() => void) | null } = {
      onsuccess: null,
      onerror: null,
    };
    // The handlers are assigned after the call returns, as with the real thing.
    queueMicrotask(() => {
      request.result = produce();
      request.onsuccess?.();
    });
    return request;
  };

  const store = {
    get: (key: string) => fire(() => rows.get(key)),
    put: (value: unknown, key: string) => fire(() => rows.set(key, value)),
    delete: (key: string) =>
      fire(() => {
        if (!swallowDeletes) rows.delete(key);
      }),
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => store,
    transaction: () => ({ objectStore: () => store }),
  };

  vi.stubGlobal('indexedDB', { open: () => fire(() => db) });
  return {
    rows,
    /** Simulates the page going away before the transaction commits. */
    swallowDeletes(on: boolean) {
      swallowDeletes = on;
    },
  };
}

function stubLocalStorage(): void {
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
  });
}

/** A fresh module, which is what a reload gives: the cached handle is gone. */
async function reload() {
  vi.resetModules();
  return import('./keystore');
}

async function aRecord(): Promise<DerivedKey & { expiresAt: number | null }> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return { key, verifier: 'dg==', kdf: { algo: 'PBKDF2-SHA256', iterations: 720_000, salt: 'c2FsdA==' }, expiresAt: null };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('bloquear tem de valer no instante em que se carrega', () => {
  it('um registo que sobreviveu ao próprio delete não reabre o cofre', async () => {
    stubLocalStorage();
    const idb = stubIndexedDB({ v1: await aRecord() });

    // Controlo. Sem nada bloqueado o registo abre mesmo — é isto que faz da
    // metade seguinte uma prova, e não uma tautologia sobre devolver null.
    await expect((await reload()).loadDerivedKey()).resolves.not.toBeNull();

    // Bloquear, com a página a morrer antes de a transação confirmar.
    idb.swallowDeletes(true);
    await (await reload()).clearDerivedKey();
    expect(idb.rows.has('v1')).toBe(true);

    // O arranque seguinte encontra o registo intacto, e recusa-o à mesma.
    await expect((await reload()).loadDerivedKey()).resolves.toBeNull();
  });

  it('e limpa o que ficou para trás, para não perguntar duas vezes', async () => {
    stubLocalStorage();
    const idb = stubIndexedDB({ v1: await aRecord() });
    idb.swallowDeletes(true);
    await (await reload()).clearDerivedKey();

    idb.swallowDeletes(false);
    await (await reload()).loadDerivedKey();
    expect(idb.rows.has('v1')).toBe(false);
  });

  it('desbloquear volta a armar o cofre', async () => {
    stubLocalStorage();
    stubIndexedDB();
    await (await reload()).clearDerivedKey();

    const keystore = await reload();
    const { expiresAt: _ignored, ...derived } = await aRecord();
    await keystore.saveDerivedKey(derived, null);

    // Um bloqueio anterior não pode deixar o cofre incapaz de se lembrar.
    await expect((await reload()).loadDerivedKey()).resolves.not.toBeNull();
  });

  it('sem localStorage não rejeita nada, em vez de exigir a senha por nada', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    });
    stubIndexedDB({ v1: await aRecord() });
    // Uma janela privada volta ao comportamento de sempre: o delete é tudo o
    // que há. Ilegível não é o mesmo que revogado.
    await expect((await reload()).loadDerivedKey()).resolves.not.toBeNull();
  });
});
