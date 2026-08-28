/**
 * Vault file format and merge semantics.
 *
 * A vault is a single JSON envelope. Only `payload` is encrypted; the header is
 * public metadata needed to derive the key, and is authenticated as AAD so it
 * cannot be tampered with.
 */
import {
  CIPHER,
  DecryptionError,
  type DerivedKey,
  type KdfParams,
  type SealedBox,
  deriveKey,
  newKdfParams,
  open,
  seal,
  timingSafeEqual,
} from './crypto';
import type { VaultItem } from './model';

export const VAULT_FORMAT = 'equantic-keeper.vault';
export const VAULT_VERSION = 1;

/** Trashed items are purged from the payload after this many days. */
export const TOMBSTONE_TTL_DAYS = 90;

export interface VaultFile {
  format: typeof VAULT_FORMAT;
  version: number;
  kdf: KdfParams;
  cipher: typeof CIPHER;
  verifier: string;
  iv: string;
  data: string;
  /** Public, non-sensitive: lets us order syncs without decrypting. */
  updatedAt: string;
}

export interface VaultPayload {
  items: VaultItem[];
  /** Preferences that follow the vault across devices. */
  preferences: VaultPreferences;
}

export interface VaultPreferences {
  autoLockMinutes: number;
  clipboardClearSeconds: number;
  theme: 'dark' | 'light';
  concealSecrets: boolean;
}

export const DEFAULT_PREFERENCES: VaultPreferences = {
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
  theme: 'dark',
  concealSecrets: true,
};

export function emptyPayload(): VaultPayload {
  return { items: [], preferences: { ...DEFAULT_PREFERENCES } };
}

/** Header bytes bound to the ciphertext through AES-GCM additional data. */
function aad(file: Pick<VaultFile, 'format' | 'version' | 'kdf' | 'cipher'>): string {
  return [file.format, file.version, file.cipher, file.kdf.algo, file.kdf.iterations, file.kdf.salt].join('|');
}

export function isVaultFile(value: unknown): value is VaultFile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<VaultFile>;
  return (
    v.format === VAULT_FORMAT &&
    typeof v.version === 'number' &&
    typeof v.iv === 'string' &&
    typeof v.data === 'string' &&
    typeof v.verifier === 'string' &&
    !!v.kdf &&
    typeof v.kdf.salt === 'string'
  );
}

export async function createVault(password: string, payload: VaultPayload, iterations?: number) {
  const derived = await deriveKey(password, newKdfParams(iterations));
  const file = await sealVault(derived, payload);
  return { derived, file };
}

export async function sealVault(derived: DerivedKey, payload: VaultPayload): Promise<VaultFile> {
  const header = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    cipher: CIPHER,
    kdf: derived.kdf,
  } as const;
  const box: SealedBox = await seal(derived.key, payload, aad(header));
  return {
    ...header,
    verifier: derived.verifier,
    iv: box.iv,
    data: box.data,
    updatedAt: new Date().toISOString(),
  };
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Senha mestra incorreta.');
    this.name = 'WrongPasswordError';
  }
}

/** Derive from `password` and decrypt `file` in one step. */
export async function unlockVault(file: VaultFile, password: string) {
  if (file.version > VAULT_VERSION) {
    throw new Error(
      `Este cofre foi criado por uma versão mais recente do Keeper (v${file.version}). Atualize o app.`,
    );
  }
  const derived = await deriveKey(password, file.kdf);
  if (!timingSafeEqual(derived.verifier, file.verifier)) throw new WrongPasswordError();
  const payload = await openVault(file, derived);
  return { derived, payload };
}

export async function openVault(file: VaultFile, derived: DerivedKey): Promise<VaultPayload> {
  if (file.cipher !== CIPHER) throw new DecryptionError(`Cifra não suportada: ${file.cipher}`);
  const raw = await open<VaultPayload>(derived.key, { iv: file.iv, data: file.data }, aad(file));
  return normalizePayload(raw);
}

/** Does `file` belong to the key we already hold? */
export function matchesKey(file: VaultFile, derived: DerivedKey): boolean {
  return (
    file.kdf.salt === derived.kdf.salt &&
    file.kdf.iterations === derived.kdf.iterations &&
    timingSafeEqual(file.verifier, derived.verifier)
  );
}

export function normalizePayload(raw: unknown): VaultPayload {
  const source = (raw ?? {}) as Partial<VaultPayload>;
  const items = Array.isArray(source.items) ? source.items.filter(isItemLike).map(normalizeItem) : [];
  return {
    items,
    preferences: { ...DEFAULT_PREFERENCES, ...(source.preferences ?? {}) },
  };
}

function isItemLike(value: unknown): value is VaultItem {
  return !!value && typeof value === 'object' && typeof (value as VaultItem).id === 'string';
}

function normalizeItem(item: VaultItem): VaultItem {
  const now = new Date().toISOString();
  return {
    id: item.id,
    type: typeof item.type === 'string' ? item.type : 'note',
    name: typeof item.name === 'string' ? item.name : '',
    description: typeof item.description === 'string' ? item.description : '',
    folder: typeof item.folder === 'string' ? item.folder : '',
    tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : [],
    fields: item.fields && typeof item.fields === 'object' ? item.fields : {},
    customFields: Array.isArray(item.customFields) ? item.customFields : [],
    favorite: Boolean(item.favorite),
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? item.createdAt ?? now,
    ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}),
  };
}

/**
 * Last-writer-wins per item, using the item's own `updatedAt`. Tombstones take
 * part in the comparison, so a deletion on one device propagates instead of
 * being resurrected by a stale copy on another.
 */
export function mergePayloads(local: VaultPayload, remote: VaultPayload): VaultPayload {
  const byId = new Map<string, VaultItem>();
  for (const item of remote.items) byId.set(item.id, item);
  for (const item of local.items) {
    const other = byId.get(item.id);
    if (!other || Date.parse(item.updatedAt) >= Date.parse(other.updatedAt)) byId.set(item.id, item);
  }
  const localNewer = Date.parse(lastTouch(local)) >= Date.parse(lastTouch(remote));
  return {
    items: purgeTombstones([...byId.values()]),
    preferences: localNewer ? local.preferences : remote.preferences,
  };
}

function lastTouch(payload: VaultPayload): string {
  return payload.items.reduce((max, item) => (item.updatedAt > max ? item.updatedAt : max), '');
}

export function purgeTombstones(items: VaultItem[], now = Date.now()): VaultItem[] {
  const cutoff = now - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000;
  return items.filter((item) => !item.deletedAt || Date.parse(item.deletedAt) > cutoff);
}

export function activeItems(items: VaultItem[]): VaultItem[] {
  return items.filter((item) => !item.deletedAt);
}

export function trashedItems(items: VaultItem[]): VaultItem[] {
  return items.filter((item) => !!item.deletedAt);
}
