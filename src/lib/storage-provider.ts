/**
 * What the app needs from a place to keep a vault.
 *
 * Everything above this line — sync, attachments, migration, sharing — talks to
 * these methods and never to Google. The Drive client was always the only
 * implementation, so the shape here is descriptive rather than invented: it is
 * what `keeper.tsx` already calls, named and written down so a second provider
 * has a target to hit instead of a class to imitate.
 *
 * Three things are deliberately NOT in the base interface:
 *
 *  - **Sharing.** Every provider models it differently, and a vault that only
 *    syncs is still a vault. It lives in `SharesFolder`, which a provider
 *    opts into by setting `shares`.
 *  - **Quota.** Nice to show, not needed to work.
 *  - **The picker.** That is Google's answer to a Google rule; another provider
 *    will have its own, or none.
 */
import type { VaultFile } from './vault';

/** One file, as every provider can describe it. */
export interface StoredFileMeta {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
  /** Whatever the provider uses to tell versions apart, when it has one. */
  headRevisionId?: string;
}

export interface RemoteVaultFile {
  meta: StoredFileMeta;
  file: VaultFile;
}

/**
 * Where a client reads and writes. `appdata` is the provider's private
 * per-app area — Drive's `appDataFolder`, OneDrive's `approot` — and `folder`
 * is a folder of the person's own, which is what can be shared.
 */
export type StorageSpace = { kind: 'appdata' } | { kind: 'folder'; id: string };

export interface VaultStorage {
  /** A name for the person: "Google Drive", "OneDrive". */
  readonly label: string;

  /* -- where we are ------------------------------------------------------- */
  readonly space: StorageSpace;
  useSpace(space: StorageSpace): void;
  /** A second client on the same account, reading somewhere else. */
  withSpace(space: StorageSpace): VaultStorage;

  /* -- listing ------------------------------------------------------------ */
  listAll(): Promise<StoredFileMeta[]>;
  listFiles(query?: string): Promise<StoredFileMeta[]>;

  /* -- the vault ---------------------------------------------------------- */
  findVault(): Promise<StoredFileMeta | null>;
  fetchVault(): Promise<RemoteVaultFile | null>;
  getMeta(fileId: string): Promise<StoredFileMeta>;
  download(fileId: string): Promise<VaultFile>;
  create(name: string, file: unknown): Promise<StoredFileMeta>;
  update(fileId: string, file: unknown): Promise<StoredFileMeta>;
  delete(fileId: string): Promise<void>;
  rotateBackups(file: VaultFile): Promise<void>;

  /* -- documents beside the vault ----------------------------------------- */
  readJson<T>(
    name: string,
    guard: (value: unknown) => value is T,
  ): Promise<{ meta: StoredFileMeta; value: T } | null>;
  readJsonById<T>(fileId: string, guard: (value: unknown) => value is T): Promise<T>;
  writeJson(name: string, value: unknown, fileId?: string): Promise<StoredFileMeta>;

  /* -- attachments, as bytes ---------------------------------------------- */
  createBlob(name: string, bytes: Uint8Array, mimeType?: string): Promise<StoredFileMeta>;
  updateBlob(fileId: string, bytes: Uint8Array, mimeType?: string): Promise<StoredFileMeta>;
  downloadBlob(fileId: string): Promise<Uint8Array>;

  /* -- a folder the person can see ---------------------------------------- */
  findFolder(name?: string): Promise<StoredFileMeta | null>;
  createFolder(name?: string): Promise<StoredFileMeta>;
  ensureFolder(name?: string): Promise<StoredFileMeta>;

  /* -- context, when the provider offers it -------------------------------- */
  storageQuota(): Promise<{ used: number; limit: number } | null>;

  /**
   * Whether this provider can hand access to another account. A provider that
   * says no keeps every sharing screen away from the person instead of letting
   * them fill in a form that ends in an error.
   *
   * A plain flag rather than a method returning a type predicate: a predicate
   * on a method cannot be written by an object literal, which makes every test
   * double and every partial implementation fight the type system for nothing.
   * `canShare` below does the narrowing.
   */
  readonly shares: boolean;
}

/** Narrows a provider to one that can also hand out access. */
export function canShare(provider: VaultStorage): provider is VaultStorage & SharesFolder {
  return provider.shares;
}

/** Who else can reach the folder, as the provider sees it. */
export interface StoragePermission {
  id: string;
  role: 'owner' | 'writer' | 'reader' | 'commenter' | 'organizer' | 'fileOrganizer';
  type: 'user' | 'group' | 'domain' | 'anyone';
  emailAddress?: string;
  displayName?: string;
}

/** The half of sharing a provider has to supply: access for one account. */
export interface SharesFolder {
  shareFolder(folderId: string, email: string, role: 'reader' | 'writer'): Promise<StoragePermission>;
  folderPermissions(folderId: string): Promise<StoragePermission[]>;
  revokePermission(folderId: string, permissionId: string): Promise<void>;
}
