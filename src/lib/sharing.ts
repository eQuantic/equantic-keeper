/**
 * The two halves of giving someone access, and the order they go in.
 *
 * A person needs both: the Drive has to let them download the bytes, and a
 * wrapped key has to let them read what they downloaded. Neither is any use
 * alone — access without a key is a folder of noise, a key without access is a
 * key to a door they cannot reach.
 *
 * The order matters more than it looks. The likely failure is a mistyped
 * e-mail, and the Drive is what rejects it, so the Drive goes first: a failure
 * there leaves nothing behind at all. If publishing the key fails afterwards,
 * the grant is taken back, because the alternative is a stranger left with
 * standing access to the folder and nobody's name against it.
 */
import {
  SHARES_FILE_NAME,
  emptyShares,
  isSharesFile,
  readInviteCode,
  wrapForLink,
  wrapForRecipient,
  type ShareRecord,
  type SharesFile,
} from './invites';
import type { DriveFileMeta, DrivePermission } from './drive';

/** The slice of the Drive client sharing needs, so it can be tested dry. */
export interface SharingDrive {
  readJson<T>(
    name: string,
    guard: (value: unknown) => value is T,
  ): Promise<{ meta: DriveFileMeta; value: T } | null>;
  writeJson(name: string, value: unknown, fileId?: string): Promise<DriveFileMeta>;
  shareFolder(folderId: string, email: string, role: 'reader' | 'writer'): Promise<DrivePermission>;
  folderPermissions(folderId: string): Promise<DrivePermission[]>;
  revokePermission(folderId: string, permissionId: string): Promise<void>;
}

export interface StoredShares {
  fileId: string | null;
  file: SharesFile;
}

export async function readShares(drive: SharingDrive): Promise<StoredShares> {
  const stored = await drive.readJson(SHARES_FILE_NAME, isSharesFile);
  return { fileId: stored?.meta.id ?? null, file: stored?.value ?? emptyShares() };
}

export async function writeShares(
  drive: SharingDrive,
  stored: StoredShares,
  shares: ShareRecord[],
): Promise<void> {
  await drive.writeJson(
    SHARES_FILE_NAME,
    { ...stored.file, shares, updatedAt: new Date().toISOString() },
    stored.fileId ?? undefined,
  );
}

export interface GrantInput {
  code: string;
  label: string;
  email: string;
  role: 'reader' | 'writer';
}

export async function grantAccess(
  drive: SharingDrive,
  folderId: string,
  dataKey: CryptoKey,
  input: GrantInput,
): Promise<ShareRecord> {
  // Before anything reaches the Drive: a code that does not parse is a typo,
  // and a typo should not cost a permission that has to be taken back.
  const recipient = await readInviteCode(input.code);
  const email = input.email.trim();
  if (!email) throw new Error('Falta a conta Google da pessoa — é por ela que o Drive libera os arquivos.');

  const permission = await drive.shareFolder(folderId, email, input.role);
  try {
    const stored = await readShares(drive);
    const record = await wrapForRecipient(dataKey, recipient, {
      label: input.label.trim() || email,
      role: input.role,
      email,
    });
    // One record per person: inviting the same code again replaces it, rather
    // than leaving two keys where the owner's list shows one name.
    const shares = [...stored.file.shares.filter((entry) => entry.fingerprint !== record.fingerprint), record];
    await writeShares(drive, stored, shares);
    return record;
  } catch (error) {
    await drive.revokePermission(folderId, permission.id).catch(() => undefined);
    throw error;
  }
}

/**
 * The same grant, but the key rides in a link instead of being wrapped to a
 * device. Returns what the owner has to send, and stores only the record.
 *
 * The secret is never written down on this side: it exists in the returned
 * link and in whatever the owner does with it. Losing it means making a new
 * invite, which is the right way round.
 */
export async function grantLinkAccess(
  drive: SharingDrive,
  folderId: string,
  dataKey: CryptoKey,
  input: Omit<GrantInput, 'code'>,
): Promise<{ record: ShareRecord; secret: string }> {
  const email = input.email.trim();
  if (!email) throw new Error('Falta a conta Google da pessoa — é por ela que o Drive libera os arquivos.');

  const permission = await drive.shareFolder(folderId, email, input.role);
  try {
    const stored = await readShares(drive);
    const { record, secret } = await wrapForLink(dataKey, {
      label: input.label.trim() || email,
      role: input.role,
      email,
    });
    // One live invite per person: a new link replaces the last one, so an old
    // message stops working the moment a new one is sent.
    const shares = [
      ...stored.file.shares.filter(
        (entry) => !(entry.email && entry.email.toLowerCase() === email.toLowerCase() && entry.kind === 'link'),
      ),
      record,
    ];
    await writeShares(drive, stored, shares);
    return { record, secret };
  } catch (error) {
    await drive.revokePermission(folderId, permission.id).catch(() => undefined);
    throw error;
  }
}

export interface RemovalPlan {
  /** The record that was taken out, when there was one. */
  removed: ShareRecord | null;
  /** Everyone still invited — their records need the rotated key. */
  keep: ShareRecord[];
  stored: StoredShares;
}

/**
 * Takes one person's Drive access away and reports what is left.
 *
 * It does NOT write the shares file: the caller rotates the vault's data key
 * first and writes every remaining record around the new one, so there is never
 * a moment where the file on the Drive promises a key the vault no longer uses.
 */
export async function removeAccess(
  drive: SharingDrive,
  folderId: string,
  recordId: string,
): Promise<RemovalPlan> {
  const stored = await readShares(drive);
  const removed = stored.file.shares.find((entry) => entry.id === recordId) ?? null;
  const keep = stored.file.shares.filter((entry) => entry.id !== recordId);

  if (removed?.email) {
    const permissions = await drive.folderPermissions(folderId).catch(() => []);
    const match = permissions.find(
      (permission) =>
        permission.role !== 'owner' &&
        permission.emailAddress?.toLowerCase() === removed.email?.toLowerCase(),
    );
    if (match) await drive.revokePermission(folderId, match.id);
  }

  return { removed, keep, stored };
}

/**
 * Access granted in the Drive that no key of ours matches.
 *
 * Someone added by hand in the Drive UI, or a revoke that got half way. They
 * see ciphertext and nothing else, which is harmless — but it is theirs to know
 * about, so the list says so instead of quietly hiding the difference.
 */
export function unmatchedPermissions(
  shares: ShareRecord[],
  permissions: DrivePermission[],
): DrivePermission[] {
  return permissions.filter(
    (permission) =>
      permission.role !== 'owner' &&
      !!permission.emailAddress &&
      !shares.some((share) => share.email?.toLowerCase() === permission.emailAddress?.toLowerCase()),
  );
}
