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
const KEY_ACCOUNT = 'keeper.google.account';
const KEY_THEME = 'keeper.theme';
const KEY_BIOMETRIC = 'keeper.biometric.v1';
const KEY_RECENT_TYPES = 'keeper.recentTypes.v1';

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

export function loadTheme(): 'dark' | 'light' {
  return safeGet(KEY_THEME) === 'light' ? 'light' : 'dark';
}

export function saveTheme(theme: 'dark' | 'light'): void {
  safeSet(KEY_THEME, theme);
}

/** Wipes every trace of the vault from this device (the Drive copy is untouched). */
export function wipeLocalData(): void {
  for (const key of [KEY_CACHE, KEY_ACCOUNT, KEY_BIOMETRIC]) safeRemove(key);
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
