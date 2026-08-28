/** Encrypted backups, plaintext escape hatch and file download helpers. */
import { isVaultFile, unlockVault, type VaultFile, type VaultPayload } from './vault';
import { getType, isSecretKind, type VaultItem } from './model';

export const BACKUP_EXTENSION = '.keeper.json';

export function downloadFile(filename: string, contents: string, mime = 'application/json'): void {
  const blob = new Blob([contents], { type: `${mime};charset=utf-8` });
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
