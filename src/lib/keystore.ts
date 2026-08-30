/**
 * Persisted derived key for the "never lock" preference.
 *
 * With auto-lock set to "Never", losing the page must not cost the master
 * password: browsers discard idle tabs, iOS kills backgrounded PWAs, and every
 * service-worker update reloads the app — none of which the user reads as
 * "I locked my vault". The AES-GCM CryptoKey is stored via structured clone,
 * so it stays NON-EXTRACTABLE: IndexedDB hands back a handle that can decrypt,
 * never the raw key bits. A manual lock, a preference change, a master-password
 * change or a device wipe removes it, and everything degrades to the password
 * prompt when IndexedDB is unavailable.
 */
import type { DerivedKey } from './crypto';

const DB_NAME = 'keeper-keystore';
const DB_VERSION = 1;
const STORE = 'derived';
const RECORD_KEY = 'v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        let request: IDBRequest<T>;
        try {
          request = action(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          return resolve(null);
        }
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      }),
  );
}

export async function saveDerivedKey(derived: DerivedKey): Promise<void> {
  await run('readwrite', (store) => store.put(derived, RECORD_KEY));
}

export async function loadDerivedKey(): Promise<DerivedKey | null> {
  const value = await run<unknown>('readonly', (store) => store.get(RECORD_KEY));
  if (!value || typeof value !== 'object') return null;
  const candidate = value as DerivedKey;
  if (typeof CryptoKey === 'undefined' || !(candidate.key instanceof CryptoKey)) return null;
  if (typeof candidate.verifier !== 'string' || typeof candidate.kdf?.salt !== 'string') return null;
  return candidate;
}

export async function clearDerivedKey(): Promise<void> {
  await run('readwrite', (store) => store.delete(RECORD_KEY));
}
