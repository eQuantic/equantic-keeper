/**
 * This device's own keypair, the one an invite is addressed to.
 *
 * Stored through structured clone, like the derived key in `keystore.ts`, so
 * the private half stays NON-EXTRACTABLE: IndexedDB hands back a handle that
 * can derive, never the raw bits. That is also why an invite belongs to a
 * device rather than to a person — nothing here can be copied to a second
 * phone, by us or by anyone who gets hold of the database.
 *
 * Losing it (a wiped browser, a private window) costs an invite, not a vault:
 * the owner sends a new one against the new code. Which is the right way round.
 */
import { createIdentity, type Identity } from './invites';

const DB_NAME = 'keeper-identity';
const DB_VERSION = 1;
const STORE = 'identity';
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

export async function loadIdentity(): Promise<Identity | null> {
  const value = await run<unknown>('readonly', (store) => store.get(RECORD_KEY));
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Identity>;
  if (typeof CryptoKey === 'undefined') return null;
  if (!(candidate.publicKey instanceof CryptoKey) || !(candidate.privateKey instanceof CryptoKey)) return null;
  return { publicKey: candidate.publicKey, privateKey: candidate.privateKey };
}

export interface EnsuredIdentity {
  identity: Identity;
  /**
   * False when the keypair could not be written down — a private window, or
   * storage the browser refuses. The invite still works in this tab and dies
   * with it, which the user has to be told BEFORE they send the code to anyone.
   */
  persisted: boolean;
}

/** The keypair this device answers to, creating it the first time. */
export async function ensureIdentity(): Promise<EnsuredIdentity> {
  const existing = await loadIdentity();
  if (existing) return { identity: existing, persisted: true };

  const identity = await createIdentity();
  const stored = await run('readwrite', (store) => store.put(identity, RECORD_KEY));
  return { identity, persisted: stored !== null };
}

/**
 * Forgets it. Every invite addressed to this device stops opening, so this is
 * part of wiping the device and never a convenience.
 */
export async function clearIdentity(): Promise<void> {
  await run('readwrite', (store) => store.delete(RECORD_KEY));
}
