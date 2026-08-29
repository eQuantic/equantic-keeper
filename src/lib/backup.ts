/** Encrypted backups, plaintext escape hatch and file download helpers. */
import { driveName } from './attachments';
import { isVaultFile, unlockVault, type VaultFile, type VaultPayload } from './vault';
import { getType, isSecretKind, type VaultItem } from './model';
import type { AttachmentRef } from './model';
import { unzip, zip, type ZipEntry } from './zip';

export const BACKUP_EXTENSION = '.keeper.json';
export const BUNDLE_EXTENSION = '.keeper.zip';

/** Where each part lives inside a bundle. */
const VAULT_ENTRY = 'vault.keeper.json';
const ATTACHMENT_DIR = 'attachments/';

const utf8 = (value: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;

export function downloadBytes(filename: string, bytes: Uint8Array, mime: string): void {
  download(filename, new Blob([bytes as BlobPart], { type: mime }));
}

export function downloadFile(filename: string, contents: string, mime = 'application/json'): void {
  download(filename, new Blob([contents], { type: `${mime};charset=utf-8` }));
}

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/**
 * Exports the vault exactly as it is stored: still encrypted with the master
 * password. Safe to keep anywhere the user likes.
 */
export function exportEncrypted(file: VaultFile): void {
  downloadFile(`equantic-keeper-${stamp()}${BACKUP_EXTENSION}`, JSON.stringify(file, null, 2));
}

/**
 * Exports the vault together with the attachment ciphertext, as a ZIP.
 *
 * Without this, a backup was only half a backup: the vault told you a scan of
 * the residence permit existed, and the bytes stayed in Drive. Everything in
 * the archive is the same ciphertext the app stores, so the file is as safe to
 * keep anywhere as the vault alone — and as unreadable without the master
 * password.
 */
export function exportBundle(file: VaultFile, attachments: Map<string, Uint8Array>): void {
  const entries: ZipEntry[] = [{ name: VAULT_ENTRY, bytes: utf8(JSON.stringify(file, null, 2)) }];
  for (const [id, bytes] of attachments) {
    entries.push({ name: `${ATTACHMENT_DIR}${driveName({ id })}`, bytes });
  }
  downloadBytes(`equantic-keeper-${stamp()}${BUNDLE_EXTENSION}`, zip(entries), 'application/zip');
}

export interface Bundle {
  file: VaultFile;
  /** Attachment id -> ciphertext, exactly as the vault references it. */
  attachments: Map<string, Uint8Array>;
}

/**
 * Reads a bundle. The vault entry is mandatory; a stray file in the archive is
 * ignored rather than fatal, so a backup opened, poked at and re-zipped by the
 * user still restores.
 */
export function parseBundle(bytes: Uint8Array): Bundle {
  const entries = unzip(bytes);
  const vault = entries.find((entry) => entry.name === VAULT_ENTRY);
  if (!vault) throw new Error(`Arquivo inválido: o pacote não contém ${VAULT_ENTRY}.`);

  const attachments = new Map<string, Uint8Array>();
  for (const entry of entries) {
    if (!entry.name.startsWith(ATTACHMENT_DIR)) continue;
    const id = entry.name.slice(ATTACHMENT_DIR.length).replace(/^attachment-/, '').replace(/\.bin$/, '');
    if (id) attachments.set(id, entry.bytes);
  }
  return { file: parseBackup(new TextDecoder().decode(vault.bytes)), attachments };
}

/** Every attachment the payload references, trashed items included. */
export function referencedAttachments(payload: VaultPayload): AttachmentRef[] {
  return payload.items.flatMap((item) => item.attachments);
}

export function parseBackup(text: string): VaultFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Arquivo inválido: não é um JSON.');
  }
  if (!isVaultFile(parsed)) throw new Error('Arquivo inválido: não é um backup do eQuantic Keeper.');
  return parsed;
}

/** Opens a backup file with its own master password (may differ from the current one). */
export async function readBackup(text: string, password: string): Promise<VaultPayload> {
  const file = parseBackup(text);
  const { payload } = await unlockVault(file, password);
  return payload;
}

/**
 * Plaintext export. Everything readable, including private keys — offered only
 * behind an explicit confirmation so nobody is locked into this app.
 */
export function exportPlaintext(payload: VaultPayload): void {
  const items = payload.items
    .filter((item) => !item.deletedAt)
    .map((item) => ({
      name: item.name,
      type: item.type,
      typeLabel: getType(item.type).label,
      description: item.description,
      folder: item.folder,
      tags: item.tags,
      fields: item.fields,
      customFields: item.customFields.map(({ label, value }) => ({ label, value })),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }));
  downloadFile(
    `equantic-keeper-PLAINTEXT-${stamp()}.json`,
    JSON.stringify({ warning: 'CONTÉM SEGREDOS EM TEXTO PURO', exportedAt: new Date().toISOString(), items }, null, 2),
  );
}

/** Human-readable summary of what an item holds, used in confirmations. */
export function describeItem(item: VaultItem): string {
  const type = getType(item.type);
  const filled = type.fields.filter((field) => item.fields[field.id]);
  const secrets = filled.filter((field) => isSecretKind(field.kind)).length;
  return `${type.label} · ${filled.length} campo(s), ${secrets} secreto(s)`;
}
