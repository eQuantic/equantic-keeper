/**
 * Moving the vault out of the hidden app folder.
 *
 * `appDataFolder` was the right first home: the narrowest scope Drive offers,
 * invisible, impossible to touch by accident. It is also impossible to SHARE —
 * Drive will not grant another account access to anything kept there, by
 * design. Giving someone else a folder of documents therefore starts by moving
 * the files somewhere a person can be added to.
 *
 * Drive has no move between spaces, so this copies: every byte is read from the
 * app folder and written into a folder in My Drive. Nothing is deleted. The old
 * copy stays exactly where it was, which makes the whole operation safe to
 * interrupt, safe to repeat, and safe to walk away from — a second run skips
 * what is already there by name.
 */
import {
  ATTACHMENT_PREFIX,
  KEEPER_FOLDER_NAME,
  VAULT_FILE_NAME,
  type DriveFileMeta,
  type DriveSpace,
} from './drive';
import type { VaultPayload } from './vault';

/**
 * Left behind in the app folder once the vault has moved.
 *
 * Another device cannot see the new folder until it is granted the wider
 * permission, and without a sign it would happily keep syncing against the old
 * copy — two vaults drifting apart, neither of them wrong on its face. This
 * file is that sign. It holds no secrets: a name and a date.
 */
export const MOVED_MARKER_NAME = 'moved-to-drive-folder.json';

export interface MovedMarker {
  folderName: string;
  movedAt: string;
}

/** The slice of the Drive client a migration needs, so it can be tested dry. */
export interface MigrationDrive {
  listAll(): Promise<DriveFileMeta[]>;
  downloadBlob(fileId: string): Promise<Uint8Array>;
  createBlob(name: string, bytes: Uint8Array, mimeType?: string): Promise<DriveFileMeta>;
  delete(fileId: string): Promise<void>;
  ensureFolder(name?: string): Promise<DriveFileMeta>;
  withSpace(space: DriveSpace): MigrationDrive;
}

export interface MigrationReport {
  folderId: string;
  /** The vault's id in the new folder, once it is there. */
  vaultFileId: string | null;
  /** Old Drive file id → new one, for every attachment now in the folder. */
  moved: Map<string, string>;
  copied: number;
  /** Already in the folder from an earlier run. */
  skipped: number;
  /** Names that could not be copied; the originals are untouched. */
  failed: string[];
  bytes: number;
}

/** True when the vault this device syncs against has moved somewhere else. */
export function readMovedMarker(files: DriveFileMeta[]): boolean {
  return files.some((file) => file.name === MOVED_MARKER_NAME);
}

export interface MigrationProgress {
  done: number;
  total: number;
  name: string;
}

function mimeFor(name: string): string {
  return name.endsWith('.json') ? 'application/json' : 'application/octet-stream';
}

/**
 * The vault goes last on purpose: until it is there, the folder holds a set of
 * attachments and nothing claiming to be a vault, which is a state the app
 * reads as "not migrated yet" rather than as a vault missing its files.
 */
function copyOrder(a: DriveFileMeta, b: DriveFileMeta): number {
  return Number(a.name === VAULT_FILE_NAME) - Number(b.name === VAULT_FILE_NAME);
}

export async function migrateToFolder(
  drive: MigrationDrive,
  onProgress?: (progress: MigrationProgress) => void,
  folderName = KEEPER_FOLDER_NAME,
): Promise<MigrationReport> {
  const folder = await drive.ensureFolder(folderName);
  const source = drive.withSpace({ kind: 'appdata' });
  const target = drive.withSpace({ kind: 'folder', id: folder.id });

  const already = new Map((await target.listAll()).map((file) => [file.name, file]));
  // The marker is about the app folder, not part of what lives in it: copying
  // it would leave the new folder holding a note saying the vault moved away.
  const files = (await source.listAll()).filter((file) => file.name !== MOVED_MARKER_NAME).sort(copyOrder);

  const report: MigrationReport = {
    folderId: folder.id,
    vaultFileId: already.get(VAULT_FILE_NAME)?.id ?? null,
    moved: new Map(),
    copied: 0,
    skipped: 0,
    failed: [],
    bytes: 0,
  };

  const record = (from: DriveFileMeta, to: DriveFileMeta) => {
    if (from.name === VAULT_FILE_NAME) report.vaultFileId = to.id;
    else if (from.name.startsWith(ATTACHMENT_PREFIX)) report.moved.set(from.id, to.id);
  };

  let done = 0;
  for (const file of files) {
    const existing = already.get(file.name);
    if (existing) {
      record(file, existing);
      report.skipped += 1;
    } else {
      try {
        const bytes = await source.downloadBlob(file.id);
        record(file, await target.createBlob(file.name, bytes, mimeFor(file.name)));
        report.copied += 1;
        report.bytes += bytes.length;
      } catch {
        // One unreadable file must not strand the other two hundred: it stays
        // in the app folder, where it was, and is named in the report.
        report.failed.push(file.name);
      }
    }
    done += 1;
    onProgress?.({ done, total: files.length, name: file.name });
  }

  // Only once the vault is actually there: a marker pointing at a folder with
  // no vault in it would send the other devices somewhere emptier than here.
  if (report.vaultFileId && !already.has(MOVED_MARKER_NAME)) {
    const marker: MovedMarker = { folderName: folderName, movedAt: new Date().toISOString() };
    await source
      .createBlob(MOVED_MARKER_NAME, new TextEncoder().encode(JSON.stringify(marker)), 'application/json')
      .catch(() => undefined);
  }

  return report;
}

/**
 * Deletes the app-folder copy, and only after checking the folder holds every
 * file by name and size. The marker stays: it is what tells the other devices
 * where their vault went, and it is the one thing here that must outlive the
 * copy it replaced.
 */
export async function discardAppDataCopy(
  drive: MigrationDrive,
  folderId: string,
): Promise<{ deleted: number; missing: string[] }> {
  const source = drive.withSpace({ kind: 'appdata' });
  const target = drive.withSpace({ kind: 'folder', id: folderId });

  const copies = new Map((await target.listAll()).map((file) => [file.name, file]));
  const originals = (await source.listAll()).filter((file) => file.name !== MOVED_MARKER_NAME);

  const missing = originals
    .filter((file) => {
      const copy = copies.get(file.name);
      if (!copy) return true;
      // Sizes only when Drive reports both, which it does for uploaded bytes.
      return !!file.size && !!copy.size && file.size !== copy.size;
    })
    .map((file) => file.name);

  if (missing.length > 0) return { deleted: 0, missing };

  let deleted = 0;
  for (const file of originals) {
    await source.delete(file.id);
    deleted += 1;
  }
  return { deleted, missing: [] };
}

/**
 * Points every attachment at its copy in the new folder. A ref whose file did
 * not make it keeps the id it had, so it still opens from the app folder.
 */
export function repointAttachments(
  payload: VaultPayload,
  moved: Map<string, string>,
): { payload: VaultPayload; changed: number } {
  let changed = 0;
  const items = payload.items.map((item) => {
    if (item.attachments.length === 0) return item;
    let touched = false;
    const attachments = item.attachments.map((ref) => {
      const to = ref.driveFileId ? moved.get(ref.driveFileId) : undefined;
      if (!to || to === ref.driveFileId) return ref;
      touched = true;
      changed += 1;
      return { ...ref, driveFileId: to };
    });
    return touched ? { ...item, attachments } : item;
  });
  return { payload: changed ? { ...payload, items } : payload, changed };
}
