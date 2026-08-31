/**
 * Local (device) persistence.
 *
 * Only ciphertext and non-sensitive settings are written here. The master key,
 * the decrypted payload and the Google access token stay in memory.
 */
import { isBiometricRecord, type BiometricRecord } from './biometric';
import { isVaultFile, type VaultFile } from './vault';

const KEY_CACHE = 'keeper.vault.cache.v1';
const KEY_CLIENT_ID = 'keeper.google.clientId';
const KEY_PICKER_KEY = 'keeper.google.pickerKey';
const KEY_ACCOUNT = 'keeper.google.account';
const KEY_THEME = 'keeper.theme';
const KEY_BIOMETRIC = 'keeper.biometric.v1';
const KEY_RECENT_TYPES = 'keeper.recentTypes.v1';
/**
 * The Drive folder the vault was moved into, when it has been. Its presence is
 * also what tells the app to keep asking for the wider Drive permission on this
 * device — a cache of a fact that lives in the Drive, not the fact itself.
 */
const KEY_DRIVE_FOLDER = 'keeper.drive.folder.v1';
/** Height in px given to the items half of the sidebar, when it was dragged. */
const KEY_SIDEBAR_SPLIT = 'keeper.sidebar.split.v1';
/** Shared vaults this device has already been let into. */
const KEY_SHARED_VAULTS = 'keeper.shared.v1';

export interface CachedVault {
  file: VaultFile;
  driveFileId?: string;
  driveRevision?: string;
  cachedAt: string;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage disabled - nothing to clean up */
  }
}

export function loadCachedVault(): CachedVault | null {
  const raw = safeGet(KEY_CACHE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedVault;
    return isVaultFile(parsed.file) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveCachedVault(cache: CachedVault): boolean {
  return safeSet(KEY_CACHE, JSON.stringify(cache));
}

export function clearCachedVault(): void {
  safeRemove(KEY_CACHE);
}

/**
 * OAuth client ids are public identifiers, not secrets. One is baked in at
 * build time for the official deployment and can be overridden at runtime, so
 * anyone can fork the app and point it at their own Google Cloud project.
 */
export function getClientId(): string {
  const override = safeGet(KEY_CLIENT_ID)?.trim();
  if (override) return override;
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
}

export function setClientId(clientId: string): void {
  const value = clientId.trim();
  if (value) safeSet(KEY_CLIENT_ID, value);
  else safeRemove(KEY_CLIENT_ID);
}

/**
 * Browser API key for the Google Picker — public like the client id, and needed
 * only by a guest opening someone else's folder. Same shape as the client id:
 * baked in for the official build, overridable on a fork.
 */
export function getPickerApiKey(): string {
  const override = safeGet(KEY_PICKER_KEY)?.trim();
  if (override) return override;
  return (import.meta.env.VITE_GOOGLE_PICKER_KEY ?? '').trim();
}

export function setPickerApiKey(key: string): void {
  const value = key.trim();
  if (value) safeSet(KEY_PICKER_KEY, value);
  else safeRemove(KEY_PICKER_KEY);
}

export function isClientIdOverridden(): boolean {
  return !!safeGet(KEY_CLIENT_ID)?.trim();
}

export interface RememberedAccount {
  email: string;
  name: string;
  picture?: string;
}

export function loadAccount(): RememberedAccount | null {
  const raw = safeGet(KEY_ACCOUNT);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RememberedAccount;
  } catch {
    return null;
  }
}

export function saveAccount(account: RememberedAccount | null): void {
  if (account) safeSet(KEY_ACCOUNT, JSON.stringify(account));
  else safeRemove(KEY_ACCOUNT);
}

/**
 * The biometric record is ciphertext plus public parameters — opening it
 * still requires the platform authenticator (see `lib/biometric.ts`).
 */
export function loadBiometricRecord(): BiometricRecord | null {
  const raw = safeGet(KEY_BIOMETRIC);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isBiometricRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveBiometricRecord(record: BiometricRecord): boolean {
  return safeSet(KEY_BIOMETRIC, JSON.stringify(record));
}

export function clearBiometricRecord(): void {
  safeRemove(KEY_BIOMETRIC);
}

/**
 * Device-local convenience for the new-item wizard: the last used TYPE IDS,
 * never values. Losing it costs two taps.
 */
export function loadRecentTypes(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_RECENT_TYPES) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(0, 4) : [];
  } catch {
    return [];
  }
}

export function pushRecentType(id: string): void {
  try {
    const next = [id, ...loadRecentTypes().filter((known) => known !== id)].slice(0, 4);
    localStorage.setItem(KEY_RECENT_TYPES, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

export function loadDriveFolder(): string | null {
  return safeGet(KEY_DRIVE_FOLDER);
}

export function saveDriveFolder(folderId: string): void {
  safeSet(KEY_DRIVE_FOLDER, folderId);
}

export function clearDriveFolder(): void {
  safeRemove(KEY_DRIVE_FOLDER);
}

/** Null until the divider is dragged: until then each half sizes itself. */
export function loadSidebarSplit(): number | null {
  const raw = safeGet(KEY_SIDEBAR_SPLIT);
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function saveSidebarSplit(height: number): void {
  safeSet(KEY_SIDEBAR_SPLIT, String(Math.round(height)));
}

/**
 * A vault someone else shared, once this device has been through the picker for
 * it. The Drive grant that the pick created belongs to the account and outlives
 * the tab, so remembering the ids is enough to walk straight back in — and the
 * key still comes from the share record, which the owner can revoke at any time.
 * Nothing secret is stored here: two file ids and a name.
 */
export interface KnownSharedVault {
  folderId: string | null;
  vaultFileId: string;
  label: string;
}

export function loadSharedVaults(): KnownSharedVault[] {
  const raw = safeGet(KEY_SHARED_VAULTS);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is KnownSharedVault =>
        !!entry && typeof entry === 'object' && typeof (entry as KnownSharedVault).vaultFileId === 'string',
    );
  } catch {
    return [];
  }
}

export function rememberSharedVault(entry: KnownSharedVault): void {
  const others = loadSharedVaults().filter((known) => known.vaultFileId !== entry.vaultFileId);
  safeSet(KEY_SHARED_VAULTS, JSON.stringify([...others, entry]));
}

export function forgetSharedVault(vaultFileId: string): void {
  const left = loadSharedVaults().filter((known) => known.vaultFileId !== vaultFileId);
  if (left.length === 0) safeRemove(KEY_SHARED_VAULTS);
  else safeSet(KEY_SHARED_VAULTS, JSON.stringify(left));
}

export function loadTheme(): 'dark' | 'light' {
  return safeGet(KEY_THEME) === 'light' ? 'light' : 'dark';
}

export function saveTheme(theme: 'dark' | 'light'): void {
  safeSet(KEY_THEME, theme);
}

/** Wipes every trace of the vault from this device (the Drive copy is untouched). */
export function wipeLocalData(): void {
  for (const key of [KEY_CACHE, KEY_ACCOUNT, KEY_BIOMETRIC, KEY_DRIVE_FOLDER, KEY_SHARED_VAULTS]) safeRemove(key);
}

const NOTE_PANES_KEY = 'keeper.note.panes.v1';

export interface NotePanes {
  details: boolean;
  outline: boolean;
}

/** Which columns the note dialog opens with — a preference, not vault data. */
export function loadNotePanes(): NotePanes {
  try {
    const raw = localStorage.getItem(NOTE_PANES_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<NotePanes>) : {};
    return { details: parsed.details !== false, outline: parsed.outline !== false };
  } catch {
    return { details: true, outline: true };
  }
}

export function saveNotePanes(panes: NotePanes): void {
  try {
    localStorage.setItem(NOTE_PANES_KEY, JSON.stringify(panes));
  } catch {
    /* a private window keeps the defaults */
  }
}
