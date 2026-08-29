/**
 * Local cache for attachment ciphertext, in IndexedDB.
 *
 * localStorage is out of the question here: a single scanned residence permit
 * is larger than the ~5 MB the whole origin gets. What lands here is exactly
 * what Drive receives — AES-GCM ciphertext — so a stolen laptop gains nothing
 * from the cache that it would not gain from the Drive copy.
 *
 * Every call resolves instead of throwing when IndexedDB is unavailable
 * (private windows, storage disabled). The cache is an optimisation and an
 * offline convenience; losing it costs a download, never data.
 */

const DB_NAME = 'keeper-attachments';
const DB_VERSION = 1;
const STORE = 'ciphertext';

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
      new Promise<T | null>((resolve) => {
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

export async function putCiphertext(id: string, bytes: Uint8Array): Promise<void> {
  // Copy into a plain ArrayBuffer: a view over a larger buffer would store the
  // whole backing buffer, and structured clone rejects some typed-array views.
  await run('readwrite', (store) => store.put(bytes.slice().buffer, id));
}

export async function getCiphertext(id: string): Promise<Uint8Array | null> {
  const buffer = await run<ArrayBuffer>('readonly', (store) => store.get(id));
  return buffer ? new Uint8Array(buffer) : null;
}

export async function removeCiphertext(id: string): Promise<void> {
  await run('readwrite', (store) => store.delete(id));
}

export async function clearCiphertext(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}

/** Ids currently cached — used to drop blobs whose item is long gone. */
export async function cachedIds(): Promise<string[]> {
  const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  return (keys ?? []).filter((key): key is string => typeof key === 'string');
}
