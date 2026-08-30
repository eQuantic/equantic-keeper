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
import { DEFAULT_WARNING_DAYS } from './expiry';
import type { AttachmentRef, CustomTypeDef, FieldDef, FieldKind, Folder, Person, VaultItem } from './model';

export const VAULT_FORMAT = 'equantic-keeper.vault';
/**
 * v2 added `people` and `holderId`; v3 added `item.attachments`; v4 added
 * explicitly created `folders`; v5 adds user-defined `customTypes`. Each bump
 * matters: a client that predates one would silently drop what it does not
 * understand on its next save, so refusing to open a newer vault (which
 * `unlockVault` already does) is the safe failure. Older vaults still open —
 * `normalizePayload` fills in what is missing.
 */
export const VAULT_VERSION = 5;

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
  /** Document holders: you, spouse, children. */
  people: Person[];
  /** Folders created in the sidebar; the ones items reference are derived. */
  folders: Folder[];
  /** User-defined types, built in the wizard's form builder. */
  customTypes: CustomTypeDef[];
  /** Preferences that follow the vault across devices. */
  preferences: VaultPreferences;
}

export interface VaultPreferences {
  autoLockMinutes: number;
  clipboardClearSeconds: number;
  theme: 'dark' | 'light';
  concealSecrets: boolean;
  /** How far ahead a validity date starts being flagged. */
  expiryWarningDays: number;
}

export const DEFAULT_PREFERENCES: VaultPreferences = {
  autoLockMinutes: 15,
  clipboardClearSeconds: 30,
  theme: 'dark',
  concealSecrets: true,
  expiryWarningDays: DEFAULT_WARNING_DAYS,
};

export function emptyPayload(): VaultPayload {
  return { items: [], people: [], folders: [], customTypes: [], preferences: { ...DEFAULT_PREFERENCES } };
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
  assertSupportedVersion(file);
  const derived = await deriveKey(password, file.kdf);
  return unlockVaultWithDerived(file, derived);
}

/** Decrypt `file` with keys derived elsewhere (e.g. biometric unlock). */
export async function unlockVaultWithDerived(file: VaultFile, derived: DerivedKey) {
  assertSupportedVersion(file);
  if (!timingSafeEqual(derived.verifier, file.verifier)) throw new WrongPasswordError();
  const payload = await openVault(file, derived);
  return { derived, payload };
}

function assertSupportedVersion(file: VaultFile): void {
  if (file.version > VAULT_VERSION) {
    throw new Error(
      `Este cofre foi criado por uma versão mais recente do Keeper (v${file.version}). Atualize o app.`,
    );
  }
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
  const people = Array.isArray(source.people) ? source.people.filter(isPersonLike).map(normalizePerson) : [];
  const folders = Array.isArray(source.folders)
    ? dedupeFolders(source.folders.filter(isFolderLike).map(normalizeFolder))
    : [];
  const customTypes = Array.isArray(source.customTypes)
    ? dedupeById(source.customTypes.filter(isCustomTypeLike).map(normalizeCustomType))
    : [];
  return {
    items,
    people,
    folders,
    customTypes,
    preferences: { ...DEFAULT_PREFERENCES, ...(source.preferences ?? {}) },
  };
}

const FIELD_KINDS: ReadonlySet<FieldKind> = new Set<FieldKind>([
  'text',
  'secret',
  'multiline',
  'multilineSecret',
  'url',
  'username',
  'password',
  'totp',
  'date',
]);

function isCustomTypeLike(value: unknown): value is CustomTypeDef {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as CustomTypeDef).id === 'string' &&
    typeof (value as CustomTypeDef).label === 'string'
  );
}

/** A field from a newer client keeps its data but degrades to plain text. */
function normalizeCustomField(field: FieldDef, index: number): FieldDef {
  return {
    id: typeof field.id === 'string' && field.id ? field.id : `c${index + 1}`,
    label: typeof field.label === 'string' ? field.label : `Campo ${index + 1}`,
    kind: FIELD_KINDS.has(field.kind) ? field.kind : 'text',
    ...(field.numeric ? { numeric: true } : {}),
  };
}

function normalizeCustomType(custom: CustomTypeDef): CustomTypeDef {
  const now = new Date().toISOString();
  return {
    id: custom.id,
    label: custom.label.trim(),
    group: typeof custom.group === 'string' && custom.group.trim() ? custom.group.trim() : 'Geral',
    icon: typeof custom.icon === 'string' && custom.icon ? custom.icon : 'file',
    accent: typeof custom.accent === 'string' && custom.accent ? custom.accent : '#5b8cff',
    fields: Array.isArray(custom.fields) ? custom.fields.filter((f) => !!f && typeof f === 'object').map(normalizeCustomField) : [],
    createdAt: custom.createdAt ?? now,
    updatedAt: custom.updatedAt ?? custom.createdAt ?? now,
    ...(custom.deletedAt ? { deletedAt: custom.deletedAt } : {}),
  };
}

function dedupeById(customs: CustomTypeDef[]): CustomTypeDef[] {
  const byId = new Map<string, CustomTypeDef>();
  for (const custom of customs) {
    const current = byId.get(custom.id);
    if (!current || Date.parse(custom.updatedAt) >= Date.parse(current.updatedAt)) byId.set(custom.id, custom);
  }
  return [...byId.values()];
}

export function activeCustomTypes(customs: CustomTypeDef[]): CustomTypeDef[] {
  return customs.filter((custom) => !custom.deletedAt);
}

function isFolderLike(value: unknown): value is Folder {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Folder).name === 'string' &&
    (value as Folder).name.trim().length > 0
  );
}

function normalizeFolder(folder: Folder): Folder {
  const now = new Date().toISOString();
  return {
    name: folder.name.trim(),
    createdAt: folder.createdAt ?? now,
    updatedAt: folder.updatedAt ?? folder.createdAt ?? now,
    ...(folder.deletedAt ? { deletedAt: folder.deletedAt } : {}),
  };
}

/** Names are the identity, so a duplicated name keeps its freshest record. */
function dedupeFolders(folders: Folder[]): Folder[] {
  const byName = new Map<string, Folder>();
  for (const folder of folders) {
    const current = byName.get(folder.name);
    if (!current || Date.parse(folder.updatedAt) >= Date.parse(current.updatedAt)) {
      byName.set(folder.name, folder);
    }
  }
  return [...byName.values()];
}

export function activeFolders(folders: Folder[]): Folder[] {
  return folders.filter((folder) => !folder.deletedAt);
}

function isPersonLike(value: unknown): value is Person {
  return !!value && typeof value === 'object' && typeof (value as Person).id === 'string';
}

function normalizePerson(person: Person): Person {
  const now = new Date().toISOString();
  return {
    id: person.id,
    name: typeof person.name === 'string' ? person.name : '',
    relation: typeof person.relation === 'string' ? person.relation : '',
    birthDate: typeof person.birthDate === 'string' ? person.birthDate : '',
    createdAt: person.createdAt ?? now,
    updatedAt: person.updatedAt ?? person.createdAt ?? now,
    ...(person.deletedAt ? { deletedAt: person.deletedAt } : {}),
  };
}

/**
 * An attachment with no wrapped key is undecryptable — keeping it would only
 * put a broken thumbnail in front of the user.
 */
function isAttachmentLike(value: unknown): value is AttachmentRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Partial<AttachmentRef>;
  return typeof ref.id === 'string' && typeof ref.iv === 'string' && typeof ref.wrapped?.key === 'string';
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
    holderId: typeof item.holderId === 'string' ? item.holderId : '',
    tags: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : [],
    fields: item.fields && typeof item.fields === 'object' ? item.fields : {},
    customFields: Array.isArray(item.customFields) ? item.customFields : [],
    attachments: Array.isArray(item.attachments) ? item.attachments.filter(isAttachmentLike) : [],
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
  const peopleById = new Map<string, Person>();
  for (const person of remote.people) peopleById.set(person.id, person);
  for (const person of local.people) {
    const other = peopleById.get(person.id);
    if (!other || Date.parse(person.updatedAt) >= Date.parse(other.updatedAt)) peopleById.set(person.id, person);
  }

  const foldersByName = new Map<string, Folder>();
  for (const folder of remote.folders) foldersByName.set(folder.name, folder);
  for (const folder of local.folders) {
    const other = foldersByName.get(folder.name);
    if (!other || Date.parse(folder.updatedAt) >= Date.parse(other.updatedAt)) {
      foldersByName.set(folder.name, folder);
    }
  }

  const customById = new Map<string, CustomTypeDef>();
  for (const custom of remote.customTypes) customById.set(custom.id, custom);
  for (const custom of local.customTypes) {
    const other = customById.get(custom.id);
    if (!other || Date.parse(custom.updatedAt) >= Date.parse(other.updatedAt)) {
      customById.set(custom.id, custom);
    }
  }

  const localNewer = Date.parse(lastTouch(local)) >= Date.parse(lastTouch(remote));
  return {
    items: purgeTombstones([...byId.values()]),
    // Tombstoned people stay in the payload for the same reason items do: a
    // third device still holding the live record would otherwise resurrect it.
    people: purgeTombstones([...peopleById.values()]),
    folders: purgeTombstones([...foldersByName.values()]),
    customTypes: purgeTombstones([...customById.values()]),
    preferences: localNewer ? local.preferences : remote.preferences,
  };
}

function lastTouch(payload: VaultPayload): string {
  return payload.items.reduce((max, item) => (item.updatedAt > max ? item.updatedAt : max), '');
}

export function purgeTombstones<T extends { deletedAt?: string }>(entries: T[], now = Date.now()): T[] {
  const cutoff = now - TOMBSTONE_TTL_DAYS * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => !entry.deletedAt || Date.parse(entry.deletedAt) > cutoff);
}

export function activeItems(items: VaultItem[]): VaultItem[] {
  return items.filter((item) => !item.deletedAt);
}

export function trashedItems(items: VaultItem[]): VaultItem[] {
  return items.filter((item) => !!item.deletedAt);
}

/** People still on the list — tombstones are kept in the payload, not shown. */
export function activePeople(people: Person[]): Person[] {
  return people.filter((person) => !person.deletedAt);
}
