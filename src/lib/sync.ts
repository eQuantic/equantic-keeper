/**
 * Drive synchronisation.
 *
 * The remote copy is authoritative only to the extent that it may hold items
 * this device has not seen; conflicts are resolved per item (last writer wins)
 * rather than per file, so two devices editing different secrets never lose
 * data. Merging requires decrypting the remote copy, which only works when both
 * sides share the same master password.
 */
import type { DriveClient } from './drive';
import { VAULT_FILE_NAME } from './drive';
import type { DerivedKey } from './crypto';
import { matchesKey, mergePayloads, openVault, sealVault, type VaultFile, type VaultPayload } from './vault';

export interface SyncContext {
  drive: DriveClient;
  derived: DerivedKey;
  /** Drive file id, when this device already knows it. */
  driveFileId?: string | undefined;
  /** Revision seen the last time this device wrote or read. */
  knownRevision?: string | undefined;
}

export interface SyncResult {
  payload: VaultPayload;
  file: VaultFile;
  driveFileId: string;
  revision?: string | undefined;
  /** True when the remote copy contributed changes. */
  merged: boolean;
}

/**
 * Raised when the vault in Drive was re-encrypted with a different master
 * password (e.g. changed on another device). Merging is impossible without
 * that password, so the user has to choose a side.
 */
export class VaultPasswordMismatchError extends Error {
  constructor(readonly remote: VaultFile) {
    super('O cofre no Drive foi cifrado com outra senha mestra.');
    this.name = 'VaultPasswordMismatchError';
  }
}

async function push(
  context: SyncContext,
  payload: VaultPayload,
  fileId: string | undefined,
  merged: boolean,
): Promise<SyncResult> {
  const file = await sealVault(context.derived, payload);
  const meta = fileId
    ? await context.drive.update(fileId, file)
    : await context.drive.create(VAULT_FILE_NAME, file);
  // Best effort: a failed snapshot must never fail the save itself.
  await context.drive.rotateBackups(file).catch(() => undefined);
  return { payload, file, driveFileId: meta.id, revision: meta.headRevisionId ?? meta.modifiedTime, merged };
}

/**
 * Reconcile `localPayload` with Drive and leave both sides identical.
 * `force` skips the merge and overwrites the remote copy with the local one.
 */
export async function syncVault(
  context: SyncContext,
  localPayload: VaultPayload,
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  const remoteMeta = context.driveFileId
    ? await context.drive.getMeta(context.driveFileId).catch(() => null)
    : await context.drive.findVault();

  if (!remoteMeta) {
    return push(context, localPayload, undefined, false);
  }

  const revision = remoteMeta.headRevisionId ?? remoteMeta.modifiedTime;
  if (options.force) {
    return push(context, localPayload, remoteMeta.id, false);
  }

  // Nothing changed remotely since our last read: just publish local state.
  if (context.knownRevision && revision === context.knownRevision) {
    return push(context, localPayload, remoteMeta.id, false);
  }

  const remoteFile = await context.drive.download(remoteMeta.id);
  if (!matchesKey(remoteFile, context.derived)) {
    throw new VaultPasswordMismatchError(remoteFile);
  }

  const remotePayload = await openVault(remoteFile, context.derived);
  const merged = mergePayloads(localPayload, remotePayload);
  return push(context, merged, remoteMeta.id, true);
}

/** Pull only: used right after unlocking to refresh from another device. */
export async function pullVault(context: SyncContext): Promise<SyncResult | null> {
  const remote = await context.drive.fetchVault();
  if (!remote) return null;
  if (!matchesKey(remote.file, context.derived)) throw new VaultPasswordMismatchError(remote.file);
  return {
    payload: await openVault(remote.file, context.derived),
    file: remote.file,
    driveFileId: remote.meta.id,
    revision: remote.meta.headRevisionId ?? remote.meta.modifiedTime,
    merged: true,
  };
}
