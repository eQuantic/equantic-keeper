/**
 * Persisted derived key, so losing the page does not cost the master password:
 * browsers discard idle tabs, iOS kills backgrounded PWAs, and every
 * service-worker update reloads the app — none of which the user reads as
 * "I locked my vault". The AES-GCM CryptoKey is stored via structured clone,
 * so it stays NON-EXTRACTABLE: IndexedDB hands back a handle that can decrypt,
 * never the raw key bits.
 *
 * The record carries the auto-lock deadline: `expiresAt: null` for "never
 * lock", otherwise an epoch-ms instant after which boot refuses the record and
 * deletes it — a reload inside the inactivity window reopens silently, one
 * after it asks for the password, same contract as the in-page timer. A manual
 * lock, a master-password change or a device wipe removes the record, and
 * everything degrades to the password prompt when IndexedDB is unavailable.
 */
import type { DerivedKey } from './crypto';

const DB_NAME = 'keeper-keystore';
const DB_VERSION = 1;
const STORE = 'derived';
const RECORD_KEY = 'v1';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDatabase(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  const attempt = new Promise<IDBDatabase | null>((resolve) => {
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
  // A failed open (a transient startup race on iOS PWAs) must not poison the
  // whole session: cache only a real database, retry on the next call.
  dbPromise = attempt.then((db) => {
    if (!db) dbPromise = null;
    return db;
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

export interface StoredKey {
  derived: DerivedKey;
  /** epoch ms after which the record is dead; null = never lock. */
  expiresAt: number | null;
}

export async function saveDerivedKey(derived: DerivedKey, expiresAt: number | null): Promise<void> {
  await run('readwrite', (store) => store.put({ ...derived, expiresAt }, RECORD_KEY));
}

export async function loadDerivedKey(): Promise<StoredKey | null> {
  const value = await run<unknown>('readonly', (store) => store.get(RECORD_KEY));
  if (!value || typeof value !== 'object') return null;
  const candidate = value as DerivedKey & { expiresAt?: unknown };
  if (typeof CryptoKey === 'undefined' || !(candidate.key instanceof CryptoKey)) return null;
  if (typeof candidate.verifier !== 'string' || typeof candidate.kdf?.salt !== 'string') return null;
  return {
    derived: { key: candidate.key, verifier: candidate.verifier, kdf: candidate.kdf },
    // Records written before deadlines existed were all "never lock".
    expiresAt: typeof candidate.expiresAt === 'number' ? candidate.expiresAt : null,
  };
}

export async function clearDerivedKey(): Promise<void> {
  await run('readwrite', (store) => store.delete(RECORD_KEY));
}
