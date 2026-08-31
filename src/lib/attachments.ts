/**
 * Encrypted attachments: the scans and PDFs behind a document.
 *
 * The vault itself stays small. Each file is encrypted with its own random key
 * and stored as a separate object in the Drive app folder; the vault carries
 * only the metadata and that key, wrapped by the master key. Two consequences
 * matter in practice: changing the master password rewrites a few kilobytes
 * instead of every megabyte the user ever uploaded, and opening one document
 * downloads one file rather than the whole archive.
 *
 * Both the AES-GCM boxes are bound to the record they belong to through
 * additional authenticated data, so a ciphertext cannot be swapped between
 * attachments and the metadata in the vault cannot be edited behind the
 * plaintext's back.
 */
import {
  DecryptionError,
  generateContentKey,
  openBytes,
  sealBytes,
  unwrapContentKey,
  unwrapContentKeyRaw,
  wrapContentKey,
} from './crypto';
import type { DriveBlobApi, DriveFileMeta } from './drive';
import type { AttachmentRef } from './model';
import { getCiphertext, putCiphertext, removeCiphertext } from './blobstore';

/**
 * Big enough for a multi-page scanned certificate, small enough that both the
 * plaintext and the ciphertext fit in memory without trouble on a phone.
 */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** What the in-app viewer can actually render. */
export const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export const ACCEPT_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

export function isAccepted(mimeType: string): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(mimeType);
}

export function isPdf(ref: Pick<AttachmentRef, 'mimeType'>): boolean {
  return ref.mimeType === 'application/pdf';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Binds the wrapped key to its record: a key cannot be moved to another one. */
function keyAad(id: string): string {
  return `equantic-keeper:attachment-key:v1|${id}`;
}

/**
 * Binds the ciphertext to the metadata the UI trusts. Editing the declared MIME
 * type in the vault — the classic "rename the PDF into an HTML file" trick —
 * makes the decryption fail instead of producing something the viewer would
 * then treat as another format.
 */
function contentAad(ref: Pick<AttachmentRef, 'id' | 'mimeType' | 'size'>): string {
  return `equantic-keeper:attachment:v1|${ref.id}|${ref.mimeType}|${ref.size}`;
}

export class AttachmentTooLargeError extends Error {
  constructor(readonly size: number) {
    super(`Arquivo de ${formatBytes(size)} — o limite por anexo é ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
    this.name = 'AttachmentTooLargeError';
  }
}

export class AttachmentTypeError extends Error {
  constructor(readonly mimeType: string) {
    super('Formato não suportado. Envie PDF, JPG, PNG ou WebP.');
    this.name = 'AttachmentTypeError';
  }
}

export interface EncryptedAttachment {
  ref: AttachmentRef;
  ciphertext: Uint8Array;
}

/**
 * Encrypts one file. Nothing is uploaded here: the caller decides whether the
 * bytes go to Drive now or wait for the next sync, which is what lets a scan be
 * added with no connection.
 */
export async function encryptAttachment(master: CryptoKey, file: File): Promise<EncryptedAttachment> {
  const mimeType = file.type || guessType(file.name);
  if (!isAccepted(mimeType)) throw new AttachmentTypeError(mimeType);
  if (file.size > MAX_ATTACHMENT_BYTES) throw new AttachmentTooLargeError(file.size);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = crypto.randomUUID();
  const contentKey = await generateContentKey();
  const sealed = await sealBytes(contentKey, bytes, contentAad({ id, mimeType, size: bytes.length }));

  return {
    ref: {
      id,
      name: file.name,
      mimeType,
      size: bytes.length,
      wrapped: await wrapContentKey(master, contentKey, keyAad(id)),
      iv: sealed.iv,
      driveFileId: '',
      addedAt: new Date().toISOString(),
    },
    ciphertext: sealed.data,
  };
}

export async function decryptAttachment(
  master: CryptoKey,
  ref: AttachmentRef,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const contentKey = await unwrapContentKey(master, ref.wrapped, keyAad(ref.id));
  return openBytes(contentKey, ref.iv, ciphertext, contentAad(ref));
}

/**
 * Moves an attachment's key from one master key to another, without touching
 * the file itself: the content key is unwrapped and wrapped again.
 *
 * This is what a vault written before the key envelope needs — its attachment
 * keys hang off the PASSWORD's key, so changing the password used to orphan
 * every scan in the vault. Under the envelope they hang off the data key,
 * which a password change leaves alone.
 */
export async function rewrapAttachment(
  ref: AttachmentRef,
  from: CryptoKey,
  to: CryptoKey,
): Promise<AttachmentRef> {
  // Unwrapped extractable on purpose and only here: the raw bytes are needed
  // to wrap them under the other key, and the value never leaves this call.
  const raw = await unwrapContentKeyRaw(from, ref.wrapped, keyAad(ref.id));
  const contentKey = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ]);
  return { ...ref, wrapped: await wrapContentKey(to, contentKey, keyAad(ref.id)) };
}

/** The file name used in the Drive app folder. It leaks nothing: Drive already
 * knows the folder belongs to Keeper, and the real name is inside the vault. */
export function driveName(ref: Pick<AttachmentRef, 'id'>): string {
  return `${DRIVE_PREFIX}${ref.id}.bin`;
}

const DRIVE_PREFIX = 'attachment-';

/**
 * How long an unreferenced file is left alone before it counts as an orphan.
 * The same window the vault gives its tombstones, and for the same reason: a
 * device that has been offline may hold the only vault copy that still points
 * at the file, and its change has not reached us yet. Deleting a scan uploaded
 * minutes ago because our vault has not caught up would be unforgivable.
 */
export const ORPHAN_GRACE_DAYS = 90;

/** Reads the app folder and returns the ids of files nothing references. */
export async function findOrphans(
  drive: Pick<DriveBlobApi, 'delete'> & { listAppData(query?: string): Promise<DriveFileMeta[]> },
  referenced: AttachmentRef[],
  now = Date.now(),
): Promise<string[]> {
  const keep = new Set(referenced.map((ref) => driveName(ref)));
  const cutoff = now - ORPHAN_GRACE_DAYS * 86_400_000;

  const files = await drive.listAppData(`name contains '${DRIVE_PREFIX}' and trashed = false`);
  return files
    .filter((file) => file.name.startsWith(DRIVE_PREFIX))
    .filter((file) => !keep.has(file.name))
    .filter((file) => Date.parse(file.modifiedTime) < cutoff)
    .map((file) => file.id);
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return '';
}

/* ------------------------------------------------------------------------- *
 * Storage: local cache first, Drive second
 * ------------------------------------------------------------------------- */

/** Keeps the ciphertext on the device so the next open needs no network. */
export async function cacheAttachment(ref: AttachmentRef, ciphertext: Uint8Array): Promise<void> {
  await putCiphertext(ref.id, ciphertext);
}

/**
 * Pushes one pending attachment to Drive and returns the updated reference.
 * Already-uploaded attachments are returned untouched, so this is safe to call
 * on every sync.
 */
export async function uploadAttachment(
  drive: DriveBlobApi,
  ref: AttachmentRef,
  ciphertext?: Uint8Array,
): Promise<AttachmentRef> {
  if (ref.driveFileId) return ref;
  const bytes = ciphertext ?? (await getCiphertext(ref.id));
  if (!bytes) throw new Error(`Anexo "${ref.name}" não está mais neste dispositivo para ser enviado.`);
  const meta = await drive.createBlob(driveName(ref), bytes);
  return { ...ref, driveFileId: meta.id };
}

/**
 * Reads the ciphertext, from the device when possible. A file downloaded from
 * Drive is cached on the way through, so the second open of the same document
 * is instant and works offline.
 */
export async function fetchCiphertext(drive: DriveBlobApi | null, ref: AttachmentRef): Promise<Uint8Array> {
  const cached = await getCiphertext(ref.id);
  if (cached) return cached;
  if (!ref.driveFileId) {
    throw new Error(`O anexo "${ref.name}" ainda não foi enviado e não está neste dispositivo.`);
  }
  if (!drive) throw new Error(`Sem conexão com o Drive para baixar "${ref.name}".`);
  const bytes = await drive.downloadBlob(ref.driveFileId);
  await putCiphertext(ref.id, bytes);
  return bytes;
}

/** Decrypted bytes, ready for the viewer. */
export async function openAttachment(
  drive: DriveBlobApi | null,
  master: CryptoKey,
  ref: AttachmentRef,
): Promise<Blob> {
  const ciphertext = await fetchCiphertext(drive, ref);
  const bytes = await decryptAttachment(master, ref, ciphertext);
  return new Blob([bytes as BlobPart], { type: ref.mimeType });
}

/**
 * Forgets one attachment everywhere. The Drive copy is deleted best-effort: a
 * failure there must not stop the user from removing the reference, and the
 * orphaned ciphertext is unreadable the moment its wrapped key is gone.
 */
export async function forgetAttachment(drive: DriveBlobApi | null, ref: AttachmentRef): Promise<void> {
  await removeCiphertext(ref.id);
  if (drive && ref.driveFileId) await drive.delete(ref.driveFileId).catch(() => undefined);
}

export { DecryptionError };
