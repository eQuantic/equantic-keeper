/**
 * Application state: authentication, vault lifecycle and Drive sync.
 *
 * Mutable, security-sensitive values (the derived key, the decrypted payload,
 * Drive ids) live in refs so async flows always read the current value and are
 * never captured by a stale closure. React state mirrors what the UI renders.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { DerivedKey } from '../lib/crypto';
import { generateContentKey } from '../lib/crypto';
import {
  deriveKey,
  newKdfParams,
  deriveKeyFromMasterBits,
  deriveMasterBits,
  fromBase64,
  timingSafeEqual,
} from '../lib/crypto';
import {
  matchesVault,
  newPrfInput,
  platformAuthenticatorAvailable,
  unwrapMasterBits,
  webAuthnPrf,
  wrapMasterBits,
} from '../lib/biometric';
import { DriveClient, driveUsage, KEEPER_FOLDER_NAME, VAULT_FILE_NAME, type DriveUsage } from '../lib/drive';
import {
  MOVED_MARKER_NAME,
  discardAppDataCopy,
  migrateToFolder,
  readMovedMarker,
  repointAttachments,
} from '../lib/drive-migration';
import {
  buildInviteLink,
  findOwnShare,
  isSharesFile,
  readInviteLink,
  unwrapWithSecret,
  type InviteLink,
  rewrapShare,
  SHARES_FILE_NAME,
  unwrapWithIdentity,
  type ShareRecord,
} from '../lib/invites';
import { ensureIdentity } from '../lib/identity';
import { pickSharedItems } from '../lib/picker';
import {
  grantAccess,
  grantLinkAccess,
  readShares,
  removeAccess,
  writeShares,
  type StoredShares,
} from '../lib/sharing';
import type { DrivePermission } from '../lib/drive';
import { DRIVE_FILE_SCOPE, GoogleAuth, GoogleAuthError } from '../lib/google-auth';
import { createFolder, registerCustomTypes } from '../lib/model';
import {
  folderLeaf,
  isWithinFolder,
  movedFolderPath,
  normalizeFolderPath,
  rewriteFolderPath,
} from '../lib/folders';
import type { CustomTypeDef } from '../lib/model';
import type { AttachmentRef, Person, VaultItem } from '../lib/model';
import {
  cacheAttachment,
  encryptAttachment,
  rewrapAttachment,
  fetchCiphertext,
  findOrphans,
  forgetAttachment,
  openAttachment,
  uploadAttachment,
} from '../lib/attachments';
import {
  DEFAULT_PREFERENCES,
  createVault as buildVault,
  emptyPayload,
  mergePayloads,
  openVaultWithDataKey,
  sealVault,
  unlockVault,
  unlockVaultWithDerived,
  type VaultFile,
  type VaultKeys,
  type VaultPayload,
  type VaultPreferences,
} from '../lib/vault';
import * as storage from '../lib/storage';
import { clearDerivedKey, loadDerivedKey, saveDerivedKey } from '../lib/keystore';
import { pullVault, retryDelay, syncVault, VaultPasswordMismatchError } from '../lib/sync';
import { parseBundle, readBackup, referencedAttachments } from '../lib/backup';
import { clearClipboard } from '../lib/clipboard';

export type Phase = 'boot' | 'config' | 'signin' | 'create' | 'locked' | 'unlocked';
export type SyncStatus = 'idle' | 'syncing' | 'saved' | 'offline' | 'pending' | 'error' | 'conflict';

export interface KeeperState {
  phase: Phase;
  busy: boolean;
  error: string | null;
  notice: string | null;
  account: storage.RememberedAccount | null;
  /**
   * This device is linked to a Google account — not that a token is in hand.
   * The two used to be the same thing because the app authenticated at boot;
   * now that signing in needs a tap, a screen that waits for a live token is a
   * screen nobody can reach. Whether a request works right now is what the sync
   * status says.
   */
  connected: boolean;
  online: boolean;
  payload: VaultPayload | null;
  hasLocalVault: boolean;
  sync: { status: SyncStatus; message?: string; at?: string };
  /** This device has a user-verifying platform authenticator (Face ID, digital…). */
  biometricAvailable: boolean;
  /** A biometric record exists on this device. */
  biometricEnrolled: boolean;
  /** The record opens the vault currently loaded — show the unlock button. */
  biometricReady: boolean;
  /** Drive folder holding the vault, or null while it lives in the app folder. */
  driveFolderId: string | null;
  /** Live count while files are being copied into the folder. */
  driveMove: { done: number; total: number } | null;
  /** The app folder says this vault has moved — this device has not followed. */
  driveMovedElsewhere: boolean;
  /** An invite link this browser arrived with, waiting to be opened. */
  pendingInvite: InviteLink | null;
  /**
   * Set when what is open belongs to someone else: a vault reached through a
   * share record instead of a password. There is no master password here and no
   * local cache — the guest reads what the owner published, and nothing else.
   */
  guest: GuestSession | null;
  /**
   * Every vault this device can show right now: the person's own, plus the ones
   * shared with them. Switching between them is not signing out and in — both
   * stay open in memory, so coming back needs no master password.
   */
  workspaces: Workspace[];
  activeWorkspace: string;
}

export interface Workspace {
  id: string;
  label: string;
  kind: 'own' | 'shared';
}

export const OWN_WORKSPACE = 'own';

export interface GuestSession {
  /** What the owner granted. Editing is not wired yet, so both read for now. */
  role: 'reader' | 'writer';
  /** The name the owner gave this invite, echoed back so it is recognisable. */
  label: string;
  folderId: string | null;
  vaultFileId: string;
}

export interface KeeperActions {
  connectGoogle(interactive?: boolean): Promise<void>;
  continueOffline(): void;
  createVault(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  unlockWithBiometrics(): Promise<void>;
  enableBiometrics(password: string): Promise<void>;
  disableBiometrics(): void;
  lock(): void;
  saveItem(item: VaultItem): Promise<void>;
  /** Moves a folder (and its subtree) under another; resolves to an error message or null. */
  moveFolder(from: string, toParent: string): Promise<string | null>;
  trashItem(id: string): Promise<void>;
  restoreItem(id: string): Promise<void>;
  purgeItem(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  savePerson(person: Person): Promise<void>;
  saveFolder(name: string): Promise<void>;
  saveCustomType(def: CustomTypeDef): Promise<void>;
  removeCustomType(id: string): Promise<void>;
  removeFolder(name: string): Promise<void>;
  removePerson(id: string): Promise<void>;
  prepareAttachment(file: File): Promise<AttachmentRef>;
  readAttachment(ref: AttachmentRef): Promise<Blob>;
  discardAttachment(ref: AttachmentRef): Promise<void>;
  updatePreferences(patch: Partial<VaultPreferences>): Promise<void>;
  syncNow(force?: boolean): Promise<void>;
  changeMasterPassword(current: string, next: string): Promise<void>;
  importBackup(text: string, password: string): Promise<number>;
  importBundle(bytes: Uint8Array, password: string): Promise<{ items: number; attachments: number }>;
  collectAttachments(): Promise<{ bytes: Map<string, Uint8Array>; missing: string[] }>;
  sweepDriveOrphans(): Promise<number>;
  /** Moves the vault out of the hidden app folder into a folder in My Drive. */
  moveToDriveFolder(): Promise<void>;
  /** Deletes the app-folder copy once the new folder is verified complete. */
  discardOldDriveCopy(): Promise<{ deleted: number; missing: string[] }>;
  /** Gives one person the folder and a copy of the vault's key. */
  shareVault(input: { code: string; label: string; email: string; role: 'reader' | 'writer' }): Promise<ShareRecord>;
  /** The same, as a link to send: the guest generates and sends nothing. */
  shareVaultByLink(input: {
    label: string;
    email: string;
    role: 'reader' | 'writer';
  }): Promise<{ link: string; record: ShareRecord }>;
  /** Who the vault is shared with, from both sides: the keys and the Drive. */
  listShares(): Promise<{ shares: ShareRecord[]; permissions: DrivePermission[] }>;
  /** Takes one person's access away and rotates the key so a kept copy dies. */
  revokeShare(recordId: string): Promise<void>;
  /** Opens a vault someone else shared: pick the folder, find our key, read. */
  openSharedVault(): Promise<void>;
  /** Opens the vault an invite link points at, key and all. */
  redeemInvite(): Promise<void>;
  /** Forgets the invite this browser arrived with. */
  dismissInvite(): void;
  /** Moves between the vaults this device holds open. */
  switchWorkspace(id: string): Promise<void>;
  /** Forgets a shared vault on this device (the owner's copy is untouched). */
  forgetSharedVault(id: string): void;
  /** Reads the shared vault again — a guest has no sync, only a refresh. */
  refreshSharedVault(): Promise<void>;
  /** What this vault costs the Drive account, or null when not connected. */
  driveUsage(): Promise<DriveUsage | null>;
  currentVaultFile(): VaultFile | null;
  signOut(): Promise<void>;
  wipeDevice(): void;
  setClientId(clientId: string): void;
  notify(message: string): void;
  dismissError(): void;
  dismissNotice(): void;
}

const KeeperContext = createContext<(KeeperState & { actions: KeeperActions }) | null>(null);

const SYNC_DEBOUNCE_MS = 1500;
const INVITE_STASH = 'keeper.invite.pending';

/**
 * Takes the invite out of the address bar and keeps it for this browser session.
 *
 * Out of the address bar because it carries a key: leaving it there puts it in
 * the history, in a screenshot, in whatever the person pastes next. Into
 * sessionStorage because signing in with Google can reload the page, and losing
 * the invite at that point would leave them with a link they have already used
 * and nothing to show for it.
 */
function takePendingInvite(): InviteLink | null {
  try {
    const fromUrl = readInviteLink(window.location.hash);
    if (fromUrl) {
      sessionStorage.setItem(INVITE_STASH, JSON.stringify(fromUrl));
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return fromUrl;
    }
    const stashed = sessionStorage.getItem(INVITE_STASH);
    return stashed ? (JSON.parse(stashed) as InviteLink) : null;
  } catch {
    return null;
  }
}

export function KeeperProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KeeperState>(() => ({
    phase: 'boot',
    busy: false,
    error: null,
    notice: null,
    account: storage.loadAccount(),
    connected: !!storage.loadAccount(),
    online: navigator.onLine,
    payload: null,
    hasLocalVault: !!storage.loadCachedVault(),
    sync: { status: 'idle' },
    biometricAvailable: false,
    biometricEnrolled: !!storage.loadBiometricRecord(),
    biometricReady: false,
    driveFolderId: storage.loadDriveFolder(),
    driveMove: null,
    driveMovedElsewhere: false,
    pendingInvite: takePendingInvite(),
    guest: null,
    workspaces: [],
    activeWorkspace: OWN_WORKSPACE,
  }));

  const authRef = useRef<GoogleAuth | null>(null);
  /** Mirrors `driveMovedElsewhere` for the sync loop, which reads refs. */
  const movedElsewhereRef = useRef(false);
  /** Set only while what is open belongs to someone else. */
  const guestRef = useRef<GuestSession | null>(null);
  const guestKeyRef = useRef<CryptoKey | null>(null);
  /** The person's own vault, parked while a shared one is on screen. */
  const ownSessionRef = useRef<{
    payload: VaultPayload;
    file: VaultFile | null;
    driveFileId: string | undefined;
    revision: string | undefined;
  } | null>(null);
  /** `lock` is defined below; this lets the workspace switch reach it. */
  const lockRef = useRef<(() => void) | null>(null);
  const driveRef = useRef<DriveClient | null>(null);
  const derivedRef = useRef<DerivedKey | null>(null);
  /**
   * The content key, unwrapped from the vault's envelope. Kept beside the
   * password's key because saving needs both: one to encrypt, one to wrap.
   */
  const keysRef = useRef<VaultKeys | null>(null);
  const payloadRef = useRef<VaultPayload | null>(null);
  const fileRef = useRef<VaultFile | null>(null);
  const driveIdRef = useRef<string | undefined>(undefined);
  const revisionRef = useRef<string | undefined>(undefined);
  const syncTimerRef = useRef<number | undefined>(undefined);
  /** A change that has not reached the Drive yet, and the retry chasing it. */
  const pendingSyncRef = useRef(false);
  const retryTimerRef = useRef<number | undefined>(undefined);
  const retryAttemptRef = useRef(0);
  const bootedRef = useRef(false);

  const patch = useCallback((next: Partial<KeeperState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  /** What is on screen, described for the switcher. */
  const describeWorkspaces = useCallback((active: string) => {
    const known = storage.loadSharedVaults();
    const workspaces: Workspace[] = [
      { id: OWN_WORKSPACE, label: 'Meu cofre', kind: 'own' },
      ...known.map((entry) => ({
        id: `shared:${entry.vaultFileId}`,
        label: entry.label || 'Cofre partilhado',
        kind: 'shared' as const,
      })),
    ];
    patch({ workspaces, activeWorkspace: active });
  }, [patch]);

  const fail = useCallback(
    (error: unknown, fallback = 'Algo deu errado.') => {
      const message = error instanceof Error ? error.message : fallback;
      patch({ error: message, busy: false });
    },
    [patch],
  );

  const setPayload = useCallback(
    (payload: VaultPayload | null) => {
      payloadRef.current = payload;
      // Synchronously, not in an effect: a type saved a moment ago must
      // resolve through getType() before the next render (the builder opens
      // the editor for the brand-new type right away).
      registerCustomTypes(payload?.customTypes ?? []);
      patch({ payload });
    },
    [patch],
  );

  /**
   * Keep the derived key on-device with the auto-lock deadline stamped on it:
   * a reload inside the inactivity window must reopen without the password —
   * on iOS every app switch can reload the page, so memory-only would demand
   * the password constantly. "Never" stores no deadline; boot enforces expiry.
   */
  const syncKeystore = useCallback((derived: DerivedKey | null, minutes: number) => {
    if (derived) void saveDerivedKey(derived, minutes === 0 ? null : Date.now() + minutes * 60_000);
    else void clearDerivedKey();
  }, []);


  const biometricAvailableRef = useRef(false);
  /** Recomputes the biometric flags from storage and the vault currently loaded. */
  const refreshBiometric = useCallback(() => {
    const record = storage.loadBiometricRecord();
    const file = fileRef.current;
    patch({
      biometricAvailable: biometricAvailableRef.current,
      biometricEnrolled: !!record,
      biometricReady:
        biometricAvailableRef.current && !!record && !!file && matchesVault(record, file.kdf),
    });
  }, [patch]);

  const services = useCallback(() => {
    const clientId = storage.getClientId();
    if (!clientId) throw new Error('Configure o Google OAuth Client ID antes de conectar.');
    if (!authRef.current || authRef.current.clientId !== clientId) {
      const auth = new GoogleAuth(clientId);
      const folderId = storage.loadDriveFolder();
      // A device that already moved has to renew with the wider permission, or
      // its first request lands in a folder it is no longer allowed to open.
      if (folderId) auth.include(DRIVE_FILE_SCOPE);
      authRef.current = auth;
      driveRef.current = new DriveClient(auth, folderId ? { kind: 'folder', id: folderId } : { kind: 'appdata' });
    }
    return { auth: authRef.current, drive: driveRef.current! };
  }, []);

  /**
   * Tops up the Google token from inside a gesture.
   *
   * The Drive client only ever asks for a token it already has, because a
   * request with no click behind it opens a window the browser may refuse or
   * turn into a navigation. Every action a person actually pressed calls this
   * first: the click is the permission to open that window.
   */
  const ensureToken = useCallback(async () => {
    const { auth } = services();
    if (!auth.isSignedIn) await auth.requestToken(true, storage.loadAccount()?.email);
  }, [services]);

  /** Persist the encrypted vault locally so the app works offline. */
  const persistLocal = useCallback(async (payload: VaultPayload) => {
    const keys = keysRef.current;
    if (!keys) return null;
    const file = await sealVault(keys, payload);
    fileRef.current = file;
    const stored = storage.saveCachedVault({
      file,
      ...(driveIdRef.current ? { driveFileId: driveIdRef.current } : {}),
      ...(revisionRef.current ? { driveRevision: revisionRef.current } : {}),
      cachedAt: new Date().toISOString(),
    });
    if (!stored) {
      patch({ error: 'Não foi possível gravar o cache local (armazenamento cheio ou bloqueado).' });
    }
    return file;
  }, [patch]);

  /**
   * Uploads every attachment still missing from Drive and returns the payload
   * with the new file ids. Returns the original object when there was nothing
   * to do, so the caller can skip a re-render.
   *
   * One failure does not abort the rest: a file that cannot go up now keeps
   * its empty id and is retried on the next sync.
   */
  const pushPendingAttachments = useCallback(
    async (drive: DriveClient, payload: VaultPayload): Promise<VaultPayload> => {
      const pending = payload.items.filter((item) =>
        item.attachments.some((ref) => !ref.driveFileId),
      );
      if (pending.length === 0) return payload;

      const uploaded = new Map<string, AttachmentRef>();
      for (const item of pending) {
        for (const ref of item.attachments) {
          if (ref.driveFileId) continue;
          try {
            uploaded.set(ref.id, await uploadAttachment(drive, ref));
          } catch {
            /* stays pending; the next sync tries again */
          }
        }
      }
      if (uploaded.size === 0) return payload;

      return {
        ...payload,
        items: payload.items.map((item) =>
          item.attachments.some((ref) => uploaded.has(ref.id))
            ? { ...item, attachments: item.attachments.map((ref) => uploaded.get(ref.id) ?? ref) }
            : item,
        ),
      };
    },
    [],
  );

  const runSync = useCallback(
    async (options: { force?: boolean; silent?: boolean } = {}) => {
      const derived = derivedRef.current;
      const keys = keysRef.current;
      const payload = payloadRef.current;
      const drive = driveRef.current;
      const auth = authRef.current;
      if (!derived || !keys || !payload) return;
      // `auth.isSignedIn` is NOT part of this guard on purpose: a Google access
      // token lives about an hour, and the Drive client renews it silently on
      // every call (and once more after a 401). Refusing to try because the
      // token aged out is what used to park the app in "somente local" until
      // someone pressed Sincronizar by hand.
      if (!drive || !auth || !navigator.onLine) {
        pendingSyncRef.current = true;
        patch({
          sync: {
            status: 'pending',
            message: navigator.onLine
              ? 'Sem conexão com o Drive — tentaremos de novo sozinhos.'
              : 'Sem internet. As alterações sobem assim que a conexão voltar.',
          },
        });
        return;
      }

      // The vault moved into a folder this device cannot see, and the copy in
      // the app folder is a snapshot nobody reads any more. Writing to it would
      // bury today's edits in a file the other devices abandoned — better to
      // stop and say so. A forced sync is still the way out, deliberately.
      if (movedElsewhereRef.current && drive.space.kind === 'appdata' && !options.force) {
        pendingSyncRef.current = true;
        patch({
          sync: {
            status: 'conflict',
            message:
              'Este cofre foi movido para uma pasta do Drive em outro aparelho. Este aqui ainda usa a pasta ' +
              'oculta, então parou de enviar para não gravar na cópia antiga.',
          },
        });
        return;
      }

      patch({ sync: { status: 'syncing' } });
      try {
        // Attachments added offline carry no Drive id yet. Push the bytes
        // first, so the vault we write already points at them — the reverse
        // order would publish a reference to a file that does not exist.
        const pushed = await pushPendingAttachments(drive, payload);
        if (pushed !== payload) setPayload(pushed);

        const result = await syncVault(
          {
            drive,
            derived,
            keys,
            driveFileId: driveIdRef.current,
            knownRevision: revisionRef.current,
          },
          pushed,
          { ...(options.force ? { force: true } : {}) },
        );
        driveIdRef.current = result.driveFileId;
        revisionRef.current = result.revision;
        fileRef.current = result.file;
        if (result.merged) setPayload(result.payload);
        storage.saveCachedVault({
          file: result.file,
          driveFileId: result.driveFileId,
          ...(result.revision ? { driveRevision: result.revision } : {}),
          cachedAt: new Date().toISOString(),
        });
        pendingSyncRef.current = false;
        retryAttemptRef.current = 0;
        window.clearTimeout(retryTimerRef.current);
        patch({ sync: { status: 'saved', at: new Date().toISOString() } });
      } catch (error) {
        if (error instanceof VaultPasswordMismatchError) {
          patch({
            sync: {
              status: 'conflict',
              message:
                'O cofre no Drive usa outra senha mestra. Desbloqueie com ela ou sobrescreva o Drive com esta versão.',
            },
          });
          return;
        }
        const message = error instanceof Error ? error.message : 'Falha ao sincronizar.';
        // A failed sync is a promise to try again, not a dead end: the change
        // is already safe on this device, and the retry loop chases it.
        pendingSyncRef.current = true;
        // An expired Google session is not a failure to retry — no timer can
        // fix it, because reconnecting needs a tap. Say that instead of
        // blinking an error every few minutes.
        const expired = error instanceof GoogleAuthError && error.code === 'needs_gesture';
        patch({ sync: { status: expired ? 'pending' : 'error', message } });
        if (!options.silent && !expired) patch({ error: message });
      }
    },
    [patch, pushPendingAttachments, setPayload],
  );

  const scheduleSync = useCallback(() => {
    // Marked pending the moment a change happens, not when the debounce fires:
    // the retry loop is then responsible for it even if this tab goes away.
    pendingSyncRef.current = true;
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = undefined;
      void runSync({ silent: true });
    }, SYNC_DEBOUNCE_MS);
  }, [runSync]);

  /** Single funnel for every vault change: update, encrypt, cache, sync. */
  const mutate = useCallback(
    async (updater: (payload: VaultPayload) => VaultPayload) => {
      const current = payloadRef.current;
      if (!current) throw new Error('O cofre está bloqueado.');
      // A guest reads. Editing someone else's vault needs a write path of its
      // own (the header is the owner's), and until that exists this is the one
      // place that has to say no — every action funnels through here.
      if (guestRef.current) {
        throw new Error('Este cofre é de outra pessoa: por enquanto o acesso partilhado é só de leitura.');
      }
      const next = updater(current);
      setPayload(next);
      await persistLocal(next);
      scheduleSync();
    },
    [persistLocal, scheduleSync, setPayload],
  );

  /**
   * Takes the keys an unlock produced and makes them this session's.
   *
   * A vault written before the envelope hands back the password's key as the
   * content key. Here it gets a real one: minted, every attachment key moved
   * onto it, and the vault saved in the new shape. Doing it at unlock (rather
   * than lazily) means the fix for "changing the password orphaned every
   * attachment" applies from the first moment the vault is open.
   */
  const adoptKeys = useCallback(
    async (opened: {
      derived: DerivedKey;
      keys: VaultKeys;
      payload: VaultPayload;
      needsEnvelope: boolean;
    }): Promise<VaultKeys> => {
      derivedRef.current = opened.derived;
      keysRef.current = opened.keys;
      if (!opened.needsEnvelope) {
        setPayload(opened.payload);
        return opened.keys;
      }

      const keys: VaultKeys = { derived: opened.derived, data: await generateContentKey() };
      const items = await Promise.all(
        opened.payload.items.map(async (item) => {
          if (item.attachments.length === 0) return item;
          const attachments = await Promise.all(
            item.attachments.map(async (ref) => {
              try {
                return await rewrapAttachment(ref, opened.keys.data, keys.data);
              } catch {
                // A key that was already unreadable stays as it is: one broken
                // attachment must not cost the migration of everything else.
                return ref;
              }
            }),
          );
          return { ...item, attachments };
        }),
      );

      const payload = { ...opened.payload, items };
      keysRef.current = keys;
      setPayload(payload);
      await persistLocal(payload);
      scheduleSync();
      return keys;
    },
    [persistLocal, scheduleSync, setPayload],
  );

  const adoptVaultFile = useCallback(
    (file: VaultFile, driveFileId?: string, revision?: string) => {
      fileRef.current = file;
      driveIdRef.current = driveFileId ?? driveIdRef.current;
      revisionRef.current = revision ?? revisionRef.current;
      patch({ hasLocalVault: true });
      refreshBiometric();
    },
    [patch, refreshBiometric],
  );

  /**
   * Gets Google's script in place without asking anyone for anything.
   *
   * Connecting at boot is what used to happen here, and it was wrong: every
   * token request opens a window, a window with no click behind it is blocked
   * or — on a phone — navigates the whole page away, and the person came back
   * to a blank Google callback instead of their vault. Signing in is a gesture
   * now, always. This only makes that gesture work first time.
   */
  const warmUpGoogle = useCallback(async () => {
    try {
      const { auth } = services();
      await auth.preload();
    } catch {
      // No client id configured yet: the setup screen handles that.
    }
  }, [services]);

  const connectGoogle = useCallback(
    async (interactive = true) => {
      // A silent renewal runs in the background: it must never put the unlock
      // button into a loading state the user cannot dismiss.
      patch({ busy: interactive, error: null });
      try {
        const { auth, drive } = services();
        // The remembered address goes along as a hint: Google then skips the
        // account chooser for someone signed into more than one account, which
        // is most people.
        await auth.requestToken(interactive, storage.loadAccount()?.email);
        // The wider permission can be taken back from the Google account page.
        // If it is gone, the folder is unreachable and every request would fail
        // in a way nobody could read: fall back to where the vault started.
        if (drive.space.kind === 'folder' && !auth.hasScope(DRIVE_FILE_SCOPE)) {
          drive.useSpace({ kind: 'appdata' });
          storage.clearDriveFolder();
          patch({
            driveFolderId: null,
            notice:
              `A permissão da pasta "${KEEPER_FOLDER_NAME}" no Drive foi revogada. ` +
              'O cofre voltou a sincronizar pela pasta oculta do app.',
          });
        }
        // Another device may have moved this vault into a folder. Until this one
        // is granted the wider permission it cannot even see that folder, so the
        // app folder is left holding a note saying where everything went.
        if (drive.space.kind === 'appdata') {
          const marker = await drive
            .listFiles(`name = '${MOVED_MARKER_NAME}' and trashed = false`)
            .catch(() => []);
          movedElsewhereRef.current = readMovedMarker(marker);
          patch({ driveMovedElsewhere: movedElsewhereRef.current });
        }

        const account = await auth.fetchAccount();
        storage.saveAccount(account);
        patch({ account, connected: true, busy: false });

        // Bring the remote vault in when this device does not hold one yet.
        if (!fileRef.current) {
          const remote = await drive.fetchVault();
          if (remote) {
            adoptVaultFile(remote.file, remote.meta.id, remote.meta.headRevisionId ?? remote.meta.modifiedTime);
            storage.saveCachedVault({
              file: remote.file,
              driveFileId: remote.meta.id,
              driveRevision: remote.meta.headRevisionId ?? remote.meta.modifiedTime,
              cachedAt: new Date().toISOString(),
            });
            patch({ phase: 'locked' });
          } else {
            patch({ phase: 'create' });
          }
        } else if (derivedRef.current) {
          await runSync({ silent: true });
        }
      } catch (error) {
        if (!interactive && error instanceof GoogleAuthError) {
          // Nothing was attempted, so nothing was lost: the account is still
          // linked, and the sync status carries the "needs a tap" part.
          patch({ busy: false });
          return;
        }
        fail(error, 'Não foi possível conectar à conta Google.');
      }
    },
    [adoptVaultFile, fail, patch, runSync, services],
  );

  const continueOffline = useCallback(() => {
    const cached = storage.loadCachedVault();
    if (!cached) {
      patch({ error: 'Nenhum cofre salvo neste dispositivo. Conecte-se ao Google para baixar o seu.' });
      return;
    }
    adoptVaultFile(cached.file, cached.driveFileId, cached.driveRevision);
    patch({ phase: 'locked', error: null });
  }, [adoptVaultFile, patch]);

  const createVault = useCallback(
    async (password: string) => {
      patch({ busy: true, error: null });
      try {
        const { derived, keys, file } = await buildVault(password, emptyPayload());
        derivedRef.current = derived;
        keysRef.current = keys;
        adoptVaultFile(file);
        setPayload(emptyPayload());
        storage.saveCachedVault({ file, cachedAt: new Date().toISOString() });
        describeWorkspaces(OWN_WORKSPACE);
        patch({ phase: 'unlocked', busy: false, notice: 'Cofre criado. Guarde bem a sua senha mestra.' });
        void runSync({ silent: true });
      } catch (error) {
        fail(error, 'Não foi possível criar o cofre.');
      }
    },
    [adoptVaultFile, fail, patch, runSync, setPayload],
  );

  /** Pull anything newer that landed on Drive while this device was away. */
  const pullAfterUnlock = useCallback(
    async (keys: VaultKeys, payload: VaultPayload) => {
      if (!authRef.current?.isSignedIn || !navigator.onLine) return;
      try {
        const remote = await pullVault({
          drive: driveRef.current!,
          derived: keys.derived,
          keys,
          driveFileId: driveIdRef.current,
          knownRevision: revisionRef.current,
        });
        if (remote) {
          driveIdRef.current = remote.driveFileId;
          revisionRef.current = remote.revision;
          const merged = mergePayloads(payload, remote.payload);
          setPayload(merged);
          await persistLocal(merged);
          patch({ sync: { status: 'saved', at: new Date().toISOString() } });
          // Local edits made offline still have to reach Drive.
          scheduleSync();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao baixar o cofre.';
        patch({ sync: { status: 'error', message } });
      }
    },
    [patch, persistLocal, scheduleSync, setPayload],
  );

  const unlock = useCallback(
    async (password: string) => {
      const file = fileRef.current;
      if (!file) {
        patch({ error: 'Nenhum cofre carregado.' });
        return;
      }
      patch({ busy: true, error: null });
      try {
        const opened = await unlockVault(file, password);
        const keys = await adoptKeys(opened);
        setPayload(payloadRef.current ?? opened.payload);
        describeWorkspaces(OWN_WORKSPACE);
        patch({ phase: 'unlocked', busy: false });
        syncKeystore(opened.derived, opened.payload.preferences.autoLockMinutes);
        await pullAfterUnlock(keys, payloadRef.current ?? opened.payload);
      } catch (error) {
        fail(error, 'Não foi possível desbloquear o cofre.');
      }
    },
    [fail, patch, pullAfterUnlock, setPayload, syncKeystore],
  );

  const unlockWithBiometrics = useCallback(async () => {
    const file = fileRef.current;
    const record = storage.loadBiometricRecord();
    if (!file || !record) {
      patch({ error: 'Nenhum cofre carregado.' });
      return;
    }
    if (!matchesVault(record, file.kdf)) {
      // The master password changed since enrollment; the wrapped bits open
      // nothing any more, so keeping the record would only mislead.
      storage.clearBiometricRecord();
      refreshBiometric();
      patch({
        error:
          'A senha mestra mudou desde que a biometria foi ativada. Desbloqueie com a senha e reative a biometria nas Configurações.',
      });
      return;
    }
    patch({ busy: true, error: null });
    try {
      const prfOutput = await webAuthnPrf.evalPrf(record.credentialId, fromBase64(record.prfInput));
      const masterBits = await unwrapMasterBits(prfOutput, record);
      let derived: DerivedKey;
      try {
        derived = await deriveKeyFromMasterBits(masterBits, file.kdf);
      } finally {
        masterBits.fill(0);
      }
      const opened = await unlockVaultWithDerived(file, derived);
      const keys = await adoptKeys(opened);
      setPayload(payloadRef.current ?? opened.payload);
      describeWorkspaces(OWN_WORKSPACE);
      patch({ phase: 'unlocked', busy: false });
      syncKeystore(derived, opened.payload.preferences.autoLockMinutes);
      await pullAfterUnlock(keys, payloadRef.current ?? opened.payload);
    } catch (error) {
      // Dismissing the Face ID / fingerprint sheet is not a failure to report.
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
        patch({ busy: false });
        return;
      }
      fail(error, 'Não foi possível desbloquear com biometria.');
    }
  }, [fail, patch, pullAfterUnlock, refreshBiometric, setPayload]);

  const enableBiometrics = useCallback(
    async (password: string) => {
      const file = fileRef.current;
      if (!file) throw new Error('O cofre precisa estar aberto.');
      patch({ busy: true, error: null });
      const masterBits = await deriveMasterBits(password, file.kdf);
      try {
        const derived = await deriveKeyFromMasterBits(masterBits, file.kdf);
        if (!timingSafeEqual(derived.verifier, file.verifier)) {
          throw new Error('Senha mestra incorreta.');
        }
        const label = storage.loadAccount()?.email ?? 'eQuantic Keeper';
        const { credentialId } = await webAuthnPrf.create(label);
        const prfInput = newPrfInput();
        const prfOutput = await webAuthnPrf.evalPrf(credentialId, prfInput);
        const record = await wrapMasterBits(prfOutput, masterBits, credentialId, prfInput, file.kdf);
        if (!storage.saveBiometricRecord(record)) {
          throw new Error('Não foi possível gravar o registro biométrico neste navegador.');
        }
        refreshBiometric();
        patch({ busy: false, notice: 'Desbloqueio por biometria ativado neste dispositivo.' });
      } catch (error) {
        fail(error, 'Não foi possível ativar o desbloqueio por biometria.');
        throw error;
      } finally {
        masterBits.fill(0);
      }
    },
    [fail, patch, refreshBiometric],
  );

  const disableBiometrics = useCallback(() => {
    storage.clearBiometricRecord();
    refreshBiometric();
    patch({
      notice:
        'Desbloqueio por biometria desativado. A chave de acesso criada continua no dispositivo e pode ser removida no gerenciador de senhas dele.',
    });
  }, [patch, refreshBiometric]);

  const lock = useCallback(() => {
    window.clearTimeout(syncTimerRef.current);
    ownSessionRef.current = null;
    derivedRef.current = null;
    payloadRef.current = null;
    // Nothing of a guest session survives a lock: there is no local copy of
    // someone else's vault to come back to, by design.
    guestRef.current = null;
    guestKeyRef.current = null;
    // A deliberate lock always demands a credential next, whatever the
    // auto-lock preference says.
    void clearDerivedKey();
    void clearClipboard();
    setState((current) => ({
      ...current,
      phase: current.guest ? 'signin' : current.hasLocalVault || fileRef.current ? 'locked' : 'signin',
      payload: null,
      guest: null,
      error: null,
      notice: null,
    }));
  }, []);

  const touchItem = (item: VaultItem): VaultItem => ({ ...item, updatedAt: new Date().toISOString() });

  lockRef.current = lock;

  const saveItem = useCallback(
    async (item: VaultItem) => {
      await mutate((payload) => {
        const next = touchItem(item);
        const exists = payload.items.some((candidate) => candidate.id === item.id);
        return {
          ...payload,
          items: exists
            ? payload.items.map((candidate) => (candidate.id === item.id ? next : candidate))
            : [next, ...payload.items],
        };
      });
    },
    [mutate],
  );

  const patchItem = useCallback(
    (id: string, updater: (item: VaultItem) => VaultItem) =>
      mutate((payload) => ({
        ...payload,
        items: payload.items.map((item) => (item.id === id ? updater(item) : item)),
      })),
    [mutate],
  );

  const trashItem = useCallback(
    (id: string) =>
      patchItem(id, (item) => ({ ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
    [patchItem],
  );

  const restoreItem = useCallback(
    (id: string) =>
      patchItem(id, (item) => {
        const { deletedAt: _removed, ...rest } = item;
        return { ...rest, updatedAt: new Date().toISOString() };
      }),
    [patchItem],
  );

  /**
   * Hard delete. The tombstone is dropped entirely, so a device that still
   * holds the item could resurrect it on its next sync — acceptable for an
   * explicit "delete forever" on a single trusted device.
   */
  /**
   * Deleting for good also deletes the attachment bytes. Best-effort on
   * purpose: the reference is what makes a file readable, so a Drive failure
   * leaves ciphertext nobody can open rather than a document the user still
   * sees. The vault change goes ahead either way.
   */
  const dropAttachmentsOf = useCallback(
    async (items: VaultItem[]) => {
      for (const item of items) {
        for (const ref of item.attachments) {
          await forgetAttachment(driveRef.current, ref).catch(() => undefined);
        }
      }
    },
    [],
  );

  const purgeItem = useCallback(
    async (id: string) => {
      const doomed = payloadRef.current?.items.filter((item) => item.id === id) ?? [];
      await mutate((payload) => ({ ...payload, items: payload.items.filter((item) => item.id !== id) }));
      await dropAttachmentsOf(doomed);
    },
    [dropAttachmentsOf, mutate],
  );

  const emptyTrash = useCallback(async () => {
    const doomed = payloadRef.current?.items.filter((item) => item.deletedAt) ?? [];
    await mutate((payload) => ({ ...payload, items: payload.items.filter((item) => !item.deletedAt) }));
    await dropAttachmentsOf(doomed);
  }, [dropAttachmentsOf, mutate]);

  const toggleFavorite = useCallback(
    (id: string) =>
      patchItem(id, (item) => ({ ...item, favorite: !item.favorite, updatedAt: new Date().toISOString() })),
    [patchItem],
  );

  const saveCustomType = useCallback(
    (def: CustomTypeDef) =>
      mutate((payload) => {
        const stamp = new Date().toISOString();
        const next = { ...def, label: def.label.trim(), group: def.group.trim(), updatedAt: stamp };
        const exists = payload.customTypes.some((candidate) => candidate.id === def.id);
        return {
          ...payload,
          customTypes: exists
            ? payload.customTypes.map((candidate) => (candidate.id === def.id ? next : candidate))
            : [...payload.customTypes, next],
        };
      }),
    [mutate],
  );

  /** Items of the removed type keep their data and render via the fallback. */
  const removeCustomType = useCallback(
    (id: string) =>
      mutate((payload) => {
        const stamp = new Date().toISOString();
        return {
          ...payload,
          customTypes: payload.customTypes.map((candidate) =>
            candidate.id === id && !candidate.deletedAt
              ? { ...candidate, updatedAt: stamp, deletedAt: stamp }
              : candidate,
          ),
        };
      }),
    [mutate],
  );

  const saveFolder = useCallback(
    (name: string) =>
      mutate((payload) => {
        const trimmed = name.trim();
        if (!trimmed) return payload;
        const stamp = new Date().toISOString();
        const existing = payload.folders.find((folder) => folder.name === trimmed);
        if (existing && !existing.deletedAt) return payload;
        return {
          ...payload,
          folders: existing
            ? payload.folders.map((folder) =>
                folder.name === trimmed
                  ? { name: folder.name, createdAt: folder.createdAt, updatedAt: stamp }
                  : folder,
              )
            : [...payload.folders, createFolder(trimmed)],
        };
      }),
    [mutate],
  );

  /**
   * Removes the explicit record only — items referencing the name keep the
   * derived folder. The UI offers this on empty folders alone.
   */
  const removeFolder = useCallback(
    (name: string) =>
      mutate((payload) => {
        const stamp = new Date().toISOString();
        return {
          ...payload,
          folders: payload.folders.map((folder) =>
            folder.name === name && !folder.deletedAt
              ? { ...folder, updatedAt: stamp, deletedAt: stamp }
              : folder,
          ),
        };
      }),
    [mutate],
  );

  /**
   * Re-parents a folder and everything under it: the folder records and every
   * item filed at or below the old path are rewritten in ONE mutation, so a
   * half-moved subtree can never be what syncs. Returns why it refused, or
   * null when the move happened.
   */
  const moveFolder = useCallback(
    async (from: string, toParent: string): Promise<string | null> => {
      const source = normalizeFolderPath(from);
      const target = movedFolderPath(source, toParent);
      if (!source) return 'Pasta inválida.';
      if (target === source) return null;
      // Dropping a folder into its own subtree would take the branch with it.
      if (isWithinFolder(toParent, source)) return 'Uma pasta não pode entrar nela mesma.';

      const payload = payloadRef.current;
      const taken =
        payload?.folders.some((folder) => !folder.deletedAt && folder.name === target) ||
        payload?.items.some((item) => !item.deletedAt && item.folder === target);
      if (taken) return `Já existe uma pasta “${folderLeaf(target)}” aí.`;

      await mutate((current) => ({
        ...current,
        folders: current.folders.map((folder) =>
          isWithinFolder(folder.name, source)
            ? { ...folder, name: rewriteFolderPath(folder.name, source, target), updatedAt: new Date().toISOString() }
            : folder,
        ),
        items: current.items.map((item) =>
          item.folder && isWithinFolder(item.folder, source)
            ? { ...item, folder: rewriteFolderPath(item.folder, source, target), updatedAt: new Date().toISOString() }
            : item,
        ),
      }));
      return null;
    },
    [mutate],
  );

  const savePerson = useCallback(
    (person: Person) =>
      mutate((payload) => {
        const next = { ...person, name: person.name.trim(), updatedAt: new Date().toISOString() };
        const exists = payload.people.some((candidate) => candidate.id === person.id);
        return {
          ...payload,
          people: exists
            ? payload.people.map((candidate) => (candidate.id === person.id ? next : candidate))
            : [...payload.people, next],
        };
      }),
    [mutate],
  );

  /**
   * Removing a holder must not orphan their documents: the items stay, they
   * simply stop pointing at a person. Losing a document because a name was
   * deleted would be the worst possible trade. The person is tombstoned rather
   * than dropped, or the next device to sync would hand the name back.
   */
  const removePerson = useCallback(
    (id: string) =>
      mutate((payload) => {
        const stamp = new Date().toISOString();
        return {
          ...payload,
          people: payload.people.map((person) =>
            person.id === id ? { ...person, updatedAt: stamp, deletedAt: stamp } : person,
          ),
          items: payload.items.map((item) =>
            item.holderId === id ? { ...item, holderId: '', updatedAt: stamp } : item,
          ),
        };
      }),
    [mutate],
  );

  /**
   * Encrypts a file and keeps it on the device, without touching the vault:
   * the editor decides whether the reference is kept (item saved) or dropped
   * (edit cancelled). Uploading is left to the sync, so a scan can be added
   * with no connection.
   */
  const prepareAttachment = useCallback(async (file: File) => {
    const keys = keysRef.current;
    if (!keys) throw new Error('O cofre está bloqueado.');
    const { ref, ciphertext } = await encryptAttachment(keys.data, file);
    await cacheAttachment(ref, ciphertext);
    return ref;
  }, []);

  const readAttachment = useCallback(async (ref: AttachmentRef) => {
    // A guest holds the data key and nothing else: attachment keys hang off it,
    // so the same call works with no password anywhere in sight.
    const guestKey = guestKeyRef.current;
    if (guestKey) return openAttachment(driveRef.current, guestKey, ref);
    const keys = keysRef.current;
    if (!keys) throw new Error('O cofre está bloqueado.');
    try {
      return await openAttachment(driveRef.current, keys.data, ref);
    } catch (error) {
      // An attachment saved before the envelope is wrapped with the password's
      // key. It is rewrapped on the next save; until then, still open it.
      if (keys.data === keys.derived.key) throw error;
      return openAttachment(driveRef.current, keys.derived.key, ref);
    }
  }, []);

  const discardAttachment = useCallback(
    (ref: AttachmentRef) => forgetAttachment(driveRef.current, ref),
    [],
  );

  const updatePreferences = useCallback(
    async (prefs: Partial<VaultPreferences>) => {
      await mutate((payload) => ({ ...payload, preferences: { ...payload.preferences, ...prefs } }));
      if ('autoLockMinutes' in prefs) {
        syncKeystore(derivedRef.current, prefs.autoLockMinutes ?? DEFAULT_PREFERENCES.autoLockMinutes);
      }
    },
    [mutate, syncKeystore],
  );

  const readDriveUsage = useCallback(async (): Promise<DriveUsage | null> => {
    const drive = driveRef.current;
    if (!drive || !navigator.onLine) return null;
    return driveUsage(drive);
  }, []);

  const syncNow = useCallback(
    async (force = false) => {
      if (!authRef.current?.isSignedIn) {
        await connectGoogle(true);
        if (!authRef.current?.isSignedIn) return;
      }
      await runSync({ ...(force ? { force: true } : {}) });
    },
    [connectGoogle, runSync],
  );

  const changeMasterPassword = useCallback(
    async (current: string, next: string) => {
      const file = fileRef.current;
      const payload = payloadRef.current;
      if (!file || !payload) throw new Error('O cofre precisa estar aberto.');
      patch({ busy: true, error: null });
      try {
        const check = await deriveKey(current, file.kdf);
        if (!timingSafeEqual(check.verifier, file.verifier)) throw new Error('Senha mestra atual incorreta.');

        // The content key does not change: only its wrapping does. That is why
        // attachments survive a password change now — their keys hang off the
        // data key, which is exactly the same key before and after.
        const data = keysRef.current?.data;
        if (!data) throw new Error('O cofre está bloqueado.');
        const derived = await deriveKey(next, newKdfParams());
        const keys: VaultKeys = { derived, data };
        const rebuilt = await sealVault(keys, payload);
        derivedRef.current = derived;
        keysRef.current = keys;
        fileRef.current = rebuilt;
        syncKeystore(derived, payload.preferences.autoLockMinutes);
        storage.saveCachedVault({
          file: rebuilt,
          ...(driveIdRef.current ? { driveFileId: driveIdRef.current } : {}),
          cachedAt: new Date().toISOString(),
        });
        // The biometric record wraps the *old* key material; it opens nothing now.
        const hadBiometrics = !!storage.loadBiometricRecord();
        if (hadBiometrics) storage.clearBiometricRecord();
        refreshBiometric();
        patch({
          busy: false,
          notice: `Senha mestra alterada. Sincronizando com o Drive…${
            hadBiometrics ? ' O desbloqueio por biometria foi desativado; reative-o nas Configurações.' : ''
          }`,
        });
        // The remote copy cannot be merged under the new key: overwrite it.
        await runSync({ force: true });
      } catch (error) {
        fail(error, 'Não foi possível alterar a senha mestra.');
        throw error;
      }
    },
    [fail, patch, refreshBiometric, runSync],
  );

  const importBackup = useCallback(
    async (text: string, password: string) => {
      const imported = await readBackup(text, password);
      // A JSON backup has no attachment bytes with it, so its refs point at
      // files this device may not have; their keys are rewrapped when the
      // bundle form is imported, which is the form that carries the bytes.
      let added = 0;
      await mutate((payload) => {
        const before = new Set(payload.items.map((item) => item.id));
        const merged = mergePayloads(payload, imported);
        added = merged.items.filter((item) => !before.has(item.id)).length;
        return { ...merged, preferences: payload.preferences };
      });
      return added;
    },
    [mutate],
  );

  /**
   * Gathers the ciphertext of every attachment the vault references, so the
   * export can carry them. Names what could not be read instead of quietly
   * shipping half a backup — a backup you find out is incomplete years later
   * is worse than one you knew was incomplete when you made it.
   */
  const collectAttachments = useCallback(async () => {
    const payload = payloadRef.current;
    const bytes = new Map<string, Uint8Array>();
    const missing: string[] = [];
    if (!payload) return { bytes, missing };

    for (const ref of referencedAttachments(payload)) {
      try {
        bytes.set(ref.id, await fetchCiphertext(driveRef.current, ref));
      } catch {
        missing.push(ref.name);
      }
    }
    return { bytes, missing };
  }, []);

  const importBundle = useCallback(
    async (bytes: Uint8Array, password: string) => {
      const bundle = parseBundle(bytes);
      const opened = await unlockVault(bundle.file, password);
      const keys = keysRef.current;
      if (!keys) throw new Error('O cofre precisa estar aberto.');
      /*
       * The backup carries a vault of its own, with its own content key — even
       * when the password matches. Its attachment keys are wrapped by THAT key,
       * so they are moved onto this vault's before the items are merged; a ref
       * that arrives unreadable is left alone rather than silently dropped.
       */
      const imported = {
        ...opened.payload,
        items: await Promise.all(
          opened.payload.items.map(async (item) =>
            item.attachments.length === 0
              ? item
              : {
                  ...item,
                  attachments: await Promise.all(
                    item.attachments.map(async (ref) => {
                      try {
                        return await rewrapAttachment(ref, opened.keys.data, keys.data);
                      } catch {
                        return ref;
                      }
                    }),
                  ),
                },
          ),
        ),
      };

      // Restore the bytes to this device first: an item that arrives pointing
      // at an attachment nobody has is a broken document.
      let restored = 0;
      for (const ref of referencedAttachments(imported)) {
        const ciphertext = bundle.attachments.get(ref.id);
        if (!ciphertext) continue;
        await cacheAttachment(ref, ciphertext);
        restored += 1;
      }

      // The Drive ids in the backup belong to whichever account produced it.
      // Clearing them makes this account upload its own copy on the next sync,
      // which is the only way the attachment survives on a second device.
      const withLocalIds = {
        ...imported,
        items: imported.items.map((item) => ({
          ...item,
          attachments: item.attachments.map((ref) =>
            bundle.attachments.has(ref.id) ? { ...ref, driveFileId: '' } : ref,
          ),
        })),
      };

      let items = 0;
      await mutate((payload) => {
        const before = new Set(payload.items.map((item) => item.id));
        const merged = mergePayloads(payload, withLocalIds);
        items = merged.items.filter((item) => !before.has(item.id)).length;
        return { ...merged, preferences: payload.preferences };
      });
      return { items, attachments: restored };
    },
    [mutate],
  );

  /**
   * Deletes attachment files in Drive that no item points at any more. Only
   * files older than the grace window are touched, so a scan another device
   * uploaded moments ago — before its vault change reached us — is never the
   * one that gets deleted.
   */
  /**
   * Copies the vault and every attachment into a folder in My Drive, then
   * points this device at it.
   *
   * Nothing is deleted: the app folder keeps its copy, so an interrupted move
   * leaves a working vault on both sides and running it again picks up where it
   * stopped. The attachment ids change (a copy is a new file), so the vault is
   * rewritten to point at the new ones before anything is synced.
   */
  const moveToDriveFolder = useCallback(async () => {
    const drive = driveRef.current;
    const auth = authRef.current;
    if (!drive || !auth) throw new Error('Conecte a conta Google antes de mover o cofre.');
    if (!payloadRef.current) throw new Error('Abra o cofre antes de mover.');

    patch({ busy: true, error: null, driveMove: { done: 0, total: 0 } });
    try {
      await ensureToken();
      await auth.requestScope(DRIVE_FILE_SCOPE);
      const report = await migrateToFolder(drive, ({ done, total }) => patch({ driveMove: { done, total } }));

      storage.saveDriveFolder(report.folderId);
      drive.useSpace({ kind: 'folder', id: report.folderId });
      movedElsewhereRef.current = false;
      // The vault's copy is a different file: syncing before this line would
      // write the migrated vault straight back into the app folder.
      driveIdRef.current = report.vaultFileId ?? undefined;
      revisionRef.current = undefined;

      await mutate((payload) => repointAttachments(payload, report.moved).payload);
      await runSync({ force: true });

      const failed = report.failed.length;
      patch({
        busy: false,
        driveFolderId: report.folderId,
        driveMove: null,
        driveMovedElsewhere: false,
        notice: failed
          ? `Cofre movido para a pasta "${KEEPER_FOLDER_NAME}", mas ${failed} arquivo(s) não puderam ser ` +
            'copiados e continuam a ser lidos da pasta oculta. Tente mover de novo mais tarde.'
          : `Cofre movido para a pasta "${KEEPER_FOLDER_NAME}" no seu Drive. A cópia antiga continua lá, ` +
            'intacta, até você decidir apagá-la.',
      });
    } catch (error) {
      patch({ driveMove: null });
      fail(error, 'Não foi possível mover o cofre para uma pasta do Drive.');
    }
  }, [ensureToken, fail, mutate, patch, runSync]);

  /**
   * Deletes the app-folder copy left behind by the move.
   *
   * It refuses unless every file is provably in the new folder, so the answer to
   * "is it all there?" is checked rather than assumed. What it leaves behind is
   * the marker: other devices still need to be told where the vault went.
   */
  /**
   * Everything sharing needs and refuses to guess at: an open vault, a folder
   * the Drive can actually share, and the key to wrap.
   */
  const sharingContext = useCallback(() => {
    const drive = driveRef.current;
    const keys = keysRef.current;
    const folderId = storage.loadDriveFolder();
    if (!drive || !keys) throw new Error('Abra o cofre e conecte a conta Google para partilhar.');
    if (!folderId) {
      throw new Error(
        'O cofre ainda está na pasta oculta do app, que o Drive não deixa partilhar. Mova-o para uma pasta ' +
          'do seu Drive em Configurações → Onde o cofre fica.',
      );
    }
    return { drive, keys, folderId };
  }, []);

  const listShares = useCallback(async () => {
    const { drive, folderId } = sharingContext();
    const stored = await readShares(drive);
    // The Drive side can disagree with ours — someone removed by hand in the
    // Drive UI, say. Reading both is how that becomes visible instead of a lie.
    const permissions = await drive.folderPermissions(folderId).catch(() => []);
    return { shares: stored.file.shares, permissions };
  }, [sharingContext]);

  const shareVault = useCallback(
    async (input: { code: string; label: string; email: string; role: 'reader' | 'writer' }) => {
      const { drive, keys, folderId } = sharingContext();
      await ensureToken();
      return grantAccess(drive, folderId, keys.data, input);
    },
    [ensureToken, sharingContext],
  );

  const shareVaultByLink = useCallback(
    async (input: { label: string; email: string; role: 'reader' | 'writer' }) => {
      const { drive, keys, folderId } = sharingContext();
      await ensureToken();
      const { record, secret } = await grantLinkAccess(drive, folderId, keys.data, input);

      // The link points at files by id: Drive answers a get by id immediately,
      // while a listing of a folder written seconds ago may still be empty.
      const stored = await drive.readJson(SHARES_FILE_NAME, isSharesFile);
      const vaultFileId = driveIdRef.current ?? (await drive.findVault())?.id ?? '';
      const link = buildInviteLink(window.location.origin, {
        share: record.id,
        secret,
        folderId,
        vaultFileId,
        sharesFileId: stored?.meta.id ?? '',
        folderName: KEEPER_FOLDER_NAME,
      });
      return { link, record };
    },
    [ensureToken, sharingContext],
  );

  /**
   * Mints a new data key and moves everything that hangs off the old one onto
   * it: the attachments, the vault itself, and the records of everyone who is
   * staying. What it leaves behind is the point — a copy of the vault someone
   * kept before this runs stops opening with the key they hold.
   */
  const rotateDataKey = useCallback(
    async (drive: DriveClient, keep: ShareRecord[], stored: StoredShares) => {
      const keys = keysRef.current;
      const payload = payloadRef.current;
      if (!keys || !payload) throw new Error('O cofre está bloqueado.');

      const next: VaultKeys = { derived: keys.derived, data: await generateContentKey() };
      const items = await Promise.all(
        payload.items.map(async (item) => {
          if (item.attachments.length === 0) return item;
          const attachments = await Promise.all(
            item.attachments.map(async (ref) => {
              try {
                return await rewrapAttachment(ref, keys.data, next.data);
              } catch {
                return ref;
              }
            }),
          );
          return { ...item, attachments };
        }),
      );

      // Everyone who stays gets the new key before the vault is sealed with it,
      // so nobody is locked out between the two writes.
      await writeShares(drive, stored, await Promise.all(keep.map((record) => rewrapShare(record, next.data))));

      const rotated = { ...payload, items };
      keysRef.current = next;
      setPayload(rotated);
      await persistLocal(rotated);
      await runSync({ force: true });
    },
    [persistLocal, runSync, setPayload],
  );

  const revokeShare = useCallback(
    async (recordId: string) => {
      const { drive, folderId } = sharingContext();
      patch({ busy: true, error: null });
      try {
        await ensureToken();
        const plan = await removeAccess(drive, folderId, recordId);
        await rotateDataKey(drive, plan.keep, plan.stored);
        patch({
          busy: false,
          notice: plan.removed
            ? `${plan.removed.label} não tem mais acesso, e a chave do cofre foi trocada — uma cópia que tenha ` +
              'ficado com essa pessoa deixa de abrir.'
            : 'Acesso removido.',
        });
      } catch (error) {
        fail(error, 'Não foi possível revogar o acesso.');
      }
    },
    [ensureToken, fail, patch, rotateDataKey, sharingContext],
  );

  /**
   * Opens a vault that belongs to someone else.
   *
   * Three things have to line up: the Drive has to hand this account the files
   * (which is what the picker is for), the shares file has to carry a record
   * addressed to this device's key, and that record has to open. Any of the
   * three missing is a different sentence to the user, because they are three
   * different problems with three different fixes.
   */
  /**
   * Opens a shared vault whose files this device has already been let into.
   *
   * The Drive grant a pick creates belongs to the account, not the tab, so
   * coming back later needs no picker — only the ids, which are remembered, and
   * the key, which still comes from the owner's share record and stops working
   * the moment they revoke it.
   */
  const enterSharedVault = useCallback(
    async (entry: storage.KnownSharedVault) => {
      const { drive } = services();
      const client = entry.folderId ? drive.withSpace({ kind: 'folder', id: entry.folderId }) : drive;

      const { identity } = await ensureIdentity();
      const sharesFileId = entry.folderId
        ? ((await client.listAll().catch(() => [])).find((file) => file.name === SHARES_FILE_NAME)?.id ?? null)
        : null;
      if (!sharesFileId) {
        throw new Error(
          'Não consegui achar a lista de convites deste cofre. Abra-o de novo pelo seletor de arquivos.',
        );
      }
      const shares = await client.readJsonById(sharesFileId, isSharesFile);
      const record = await findOwnShare(shares, identity);
      if (!record) {
        throw new Error(
          'O seu acesso a este cofre foi retirado, ou o convite era para outro aparelho. Peça um convite novo.',
        );
      }

      const dataKey = await unwrapWithIdentity(record, identity);
      const file = await client.download(entry.vaultFileId);
      const payload = await openVaultWithDataKey(file, dataKey);

      // The owner's own session stays where it is, in memory: switching back is
      // a click, not a master password.
      if (!guestRef.current && payloadRef.current) {
        ownSessionRef.current = {
          payload: payloadRef.current,
          file: fileRef.current,
          driveFileId: driveIdRef.current,
          revision: revisionRef.current,
        };
      }

      const session: GuestSession = {
        role: record.role,
        label: record.label,
        folderId: entry.folderId,
        vaultFileId: entry.vaultFileId,
      };
      guestKeyRef.current = dataKey;
      guestRef.current = session;
      fileRef.current = file;
      driveIdRef.current = entry.vaultFileId;
      setPayload(payload);
      storage.rememberSharedVault({ ...entry, label: record.label || entry.label });
      describeWorkspaces(`shared:${entry.vaultFileId}`);
      patch({ phase: 'unlocked', busy: false, guest: session, sync: { status: 'idle' } });
    },
    [describeWorkspaces, patch, services, setPayload],
  );

  /**
   * Opens a vault that belongs to someone else, from scratch.
   *
   * Three things have to line up: the Drive has to hand this account the files
   * (which is what the picker is for), the shares file has to carry a record
   * addressed to this device's key, and that record has to open. Any of the
   * three missing is a different sentence to the user, because they are three
   * different problems with three different fixes.
   */
  const openSharedVault = useCallback(async () => {
    patch({ busy: true, error: null });
    try {
      const { auth, drive } = services();
      // A guest needs the per-file scope before the picker can hand anything
      // over; asking here rather than at sign-in keeps it out of the way of
      // people who never open someone else's vault.
      if (!auth.hasScope(DRIVE_FILE_SCOPE)) await auth.requestScope(DRIVE_FILE_SCOPE);
      const token = await auth.requestToken(true);

      const picked = await pickSharedItems(token, storage.getPickerApiKey(), KEEPER_FOLDER_NAME);
      if (picked.length === 0) {
        patch({ busy: false });
        return;
      }

      const folder = picked.find((item) => item.isFolder) ?? null;
      const client = folder ? drive.withSpace({ kind: 'folder', id: folder.id }) : drive;

      // Picked a folder: read what is inside it. Whether Drive lets us is the
      // open question this flow was built to answer, so a folder that comes
      // back empty is reported as itself rather than as "vault not found".
      const inside = folder ? await client.listAll().catch(() => []) : [];
      const named = (name: string) =>
        inside.find((file) => file.name === name)?.id ??
        picked.find((item) => item.name === name)?.id ??
        null;

      const vaultFileId = named(VAULT_FILE_NAME);
      const sharesFileId = named(SHARES_FILE_NAME);

      if (!vaultFileId || !sharesFileId) {
        throw new Error(
          folder && inside.length === 0
            ? `A pasta "${folder.name}" abriu, mas o Drive não listou nada dentro dela. Escolha os arquivos ` +
              `"${VAULT_FILE_NAME}" e "${SHARES_FILE_NAME}" diretamente no seletor.`
            : `Não encontrei "${VAULT_FILE_NAME}" e "${SHARES_FILE_NAME}" no que foi escolhido. Selecione a ` +
              'pasta do cofre que a outra pessoa partilhou com você.',
        );
      }

      await enterSharedVault({
        folderId: folder?.id ?? null,
        vaultFileId,
        label: folder?.name ?? 'Cofre partilhado',
      });
    } catch (error) {
      fail(error, 'Não foi possível abrir o cofre partilhado.');
    }
  }, [enterSharedVault, fail, patch, services]);

  /**
   * Opens the vault an invite link points at.
   *
   * The link carries the ids, so nothing has to be searched for — but it cannot
   * carry the Drive's permission. Under `drive.file` a browser reaches only what
   * its user pointed at, so the picker still happens once, filtered to the one
   * folder. After that this device remembers the vault and never asks again.
   */
  /**
   * Opens the vault an invite points at, given the ids it carries.
   *
   * Returns false when the Drive refuses — which is what happens until this
   * Google ACCOUNT has pointed at the folder once. The grant belongs to the
   * account, not to the browser, so a pick made on a laptop is enough for the
   * phone, and this is the path that then costs nothing.
   */
  const openInviteDirectly = useCallback(
    async (invite: InviteLink, folderId: string): Promise<boolean> => {
      const { drive } = services();
      try {
        const client = folderId ? drive.withSpace({ kind: 'folder', id: folderId }) : drive;
        const sharesFileId =
          invite.sharesFileId ||
          ((await client.listAll()).find((file) => file.name === SHARES_FILE_NAME)?.id ?? '');
        if (!sharesFileId) return false;

        const shares = await client.readJsonById(sharesFileId, isSharesFile);
        const record = shares.shares.find((entry) => entry.id === invite.share);
        if (!record) {
          throw new Error(
            'Este convite já não vale — a pessoa que tem o cofre pode tê-lo substituído ou revogado.',
          );
        }

        const dataKey = await unwrapWithSecret(record, invite.secret);
        const file = await client.download(invite.vaultFileId);
        const payload = await openVaultWithDataKey(file, dataKey);

        if (!guestRef.current && payloadRef.current) {
          ownSessionRef.current = {
            payload: payloadRef.current,
            file: fileRef.current,
            driveFileId: driveIdRef.current,
            revision: revisionRef.current,
          };
        }

        const session: GuestSession = {
          role: record.role,
          label: record.label,
          folderId,
          vaultFileId: invite.vaultFileId,
        };
        guestKeyRef.current = dataKey;
        guestRef.current = session;
        fileRef.current = file;
        driveIdRef.current = invite.vaultFileId;
        setPayload(payload);
        storage.rememberSharedVault({
          folderId,
          vaultFileId: invite.vaultFileId,
          label: record.label || invite.folderName,
        });
        try {
          sessionStorage.removeItem(INVITE_STASH);
        } catch {
          /* private window: nothing was stored anyway */
        }
        describeWorkspaces(`shared:${invite.vaultFileId}`);
        patch({ phase: 'unlocked', busy: false, guest: session, pendingInvite: null, sync: { status: 'idle' } });
        return true;
      } catch (error) {
        // A revoked invite is a real answer and must not be retried through the
        // picker; anything else means "the Drive has not been asked yet".
        if (error instanceof Error && error.message.includes('convite')) throw error;
        return false;
      }
    },
    [describeWorkspaces, patch, services, setPayload],
  );

  /**
   * Opens the vault an invite link points at.
   *
   * The picker is the last resort, not the first step. It costs a screen of
   * Google's, and on a browser that blocks third-party cookies — Safari, by
   * default — it cannot see the person's session at all and refuses. So the ids
   * are tried first: if this account has already been through a picker anywhere,
   * on any device, there is nothing left to ask.
   */
  const redeemInvite = useCallback(async () => {
    const invite = state.pendingInvite ?? takePendingInvite();
    if (!invite) return;
    patch({ busy: true, error: null });
    try {
      const { auth } = services();
      await ensureToken();
      if (!auth.hasScope(DRIVE_FILE_SCOPE)) await auth.requestScope(DRIVE_FILE_SCOPE);

      if (await openInviteDirectly(invite, invite.folderId)) return;

      const token = await auth.requestToken(false);
      const picked = await pickSharedItems(token, storage.getPickerApiKey(), invite.folderName || KEEPER_FOLDER_NAME);
      if (picked.length === 0) {
        patch({ busy: false });
        return;
      }

      const folderId = picked.find((item) => item.isFolder)?.id ?? invite.folderId;
      if (await openInviteDirectly(invite, folderId)) return;

      throw new Error(
        'A pasta foi escolhida, mas o Drive não liberou os arquivos dentro dela. Peça à pessoa que tem o ' +
          'cofre para partilhar também os arquivos, ou escolha-os um a um no seletor.',
      );
    } catch (error) {
      fail(error, 'Não foi possível abrir o convite.');
    }
  }, [ensureToken, fail, openInviteDirectly, patch, services, state.pendingInvite]);

  const dismissInvite = useCallback(() => {
    try {
      sessionStorage.removeItem(INVITE_STASH);
    } catch {
      /* nothing stored */
    }
    patch({ pendingInvite: null });
  }, [patch]);

  /** Back to the person's own vault, which never left memory. */
  const returnToOwnVault = useCallback(() => {
    const own = ownSessionRef.current;
    if (!own || !keysRef.current) {
      throw new Error('O seu cofre não está aberto neste dispositivo. Desbloqueie com a sua senha mestra.');
    }
    guestRef.current = null;
    guestKeyRef.current = null;
    fileRef.current = own.file;
    driveIdRef.current = own.driveFileId;
    revisionRef.current = own.revision;
    setPayload(own.payload);
    describeWorkspaces(OWN_WORKSPACE);
    patch({ guest: null, phase: 'unlocked', error: null });
  }, [describeWorkspaces, patch, setPayload]);

  const switchWorkspace = useCallback(
    async (id: string) => {
      if (id === OWN_WORKSPACE) {
        try {
          returnToOwnVault();
        } catch (error) {
          fail(error, 'Não foi possível voltar ao seu cofre.');
        }
        return;
      }
      const vaultFileId = id.replace(/^shared:/, '');
      if (guestRef.current?.vaultFileId === vaultFileId) return;
      const entry = storage.loadSharedVaults().find((known) => known.vaultFileId === vaultFileId);
      if (!entry) return;
      patch({ busy: true, error: null });
      try {
        await enterSharedVault(entry);
      } catch (error) {
        fail(error, 'Não foi possível abrir esse cofre partilhado.');
      }
    },
    [enterSharedVault, fail, patch, returnToOwnVault],
  );

  const forgetShared = useCallback(
    (id: string) => {
      const vaultFileId = id.replace(/^shared:/, '');
      storage.forgetSharedVault(vaultFileId);
      if (guestRef.current?.vaultFileId === vaultFileId) {
        try {
          returnToOwnVault();
          return;
        } catch {
          lockRef.current?.();
          return;
        }
      }
      describeWorkspaces(guestRef.current ? `shared:${guestRef.current.vaultFileId}` : OWN_WORKSPACE);
    },
    [describeWorkspaces, returnToOwnVault],
  );

  const refreshSharedVault = useCallback(async () => {
    const guest = guestRef.current;
    const dataKey = guestKeyRef.current;
    const drive = driveRef.current;
    if (!guest || !dataKey || !drive) return;
    patch({ sync: { status: 'syncing' } });
    try {
      await ensureToken();
      const client = guest.folderId ? drive.withSpace({ kind: 'folder', id: guest.folderId }) : drive;
      const file = await client.download(guest.vaultFileId);
      fileRef.current = file;
      setPayload(await openVaultWithDataKey(file, dataKey));
      patch({ sync: { status: 'saved', at: new Date().toISOString() } });
    } catch (error) {
      patch({
        sync: {
          status: 'error',
          message: error instanceof Error ? error.message : 'Falha ao ler o cofre partilhado.',
        },
      });
    }
  }, [ensureToken, patch, setPayload]);

  const discardOldDriveCopy = useCallback(async () => {
    const drive = driveRef.current;
    const folderId = storage.loadDriveFolder();
    if (!drive || !folderId) throw new Error('O cofre ainda não foi movido para uma pasta do Drive.');
    await ensureToken();
    return discardAppDataCopy(drive, folderId);
  }, [ensureToken]);

  const sweepDriveOrphans = useCallback(async () => {
    const drive = driveRef.current;
    const payload = payloadRef.current;
    if (!drive || !payload) throw new Error('Conecte a conta Google para liberar espaço.');

    await ensureToken();
    const orphans = await findOrphans(drive, referencedAttachments(payload));
    for (const id of orphans) await drive.delete(id).catch(() => undefined);
    return orphans.length;
  }, []);

  const signOut = useCallback(async () => {
    await authRef.current?.signOut();
    storage.saveAccount(null);
    patch({ connected: false, account: null, notice: 'Conta Google desconectada deste navegador.' });
  }, [patch]);

  const wipeDevice = useCallback(() => {
    storage.wipeLocalData();
    void clearDerivedKey();
    derivedRef.current = null;
    payloadRef.current = null;
    fileRef.current = null;
    driveIdRef.current = undefined;
    revisionRef.current = undefined;
    setState((current) => ({
      ...current,
      phase: storage.getClientId() ? 'signin' : 'config',
      payload: null,
      account: null,
      connected: false,
      hasLocalVault: false,
      biometricEnrolled: false,
      biometricReady: false,
      notice: 'Dados locais apagados. O cofre no Google Drive permanece intacto.',
    }));
  }, []);

  const setClientId = useCallback(
    (clientId: string) => {
      storage.setClientId(clientId);
      authRef.current = null;
      driveRef.current = null;
      // Landing on the unlock screen without adopting the cached file left
      // "Desbloquear" answering "Nenhum cofre carregado" until a reload.
      const cached = storage.loadCachedVault();
      if (cached) adoptVaultFile(cached.file, cached.driveFileId, cached.driveRevision);
      patch({
        phase: cached ? 'locked' : 'signin',
        error: null,
        notice: 'Client ID salvo neste navegador.',
      });
    },
    [adoptVaultFile, patch],
  );

  const currentVaultFile = useCallback(() => fileRef.current, []);

  // ---- boot ---------------------------------------------------------------
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;

    void platformAuthenticatorAvailable().then((available) => {
      biometricAvailableRef.current = available;
      refreshBiometric();
    });

    if (!storage.getClientId()) {
      patch({ phase: 'config' });
      return;
    }
    const cached = storage.loadCachedVault();
    if (cached) {
      adoptVaultFile(cached.file, cached.driveFileId, cached.driveRevision);
      // A non-extractable copy of the key lives on the device while the
      // auto-lock window is open (or forever, with "never"): a discarded tab
      // or an app update must not cost the password.
      void (async () => {
        const stored = await loadDerivedKey();
        if (stored && stored.expiresAt !== null && stored.expiresAt <= Date.now()) {
          await clearDerivedKey();
        } else if (stored) {
          try {
            const opened = await unlockVaultWithDerived(cached.file, stored.derived);
            const keys = await adoptKeys(opened);
            const payload = payloadRef.current ?? opened.payload;
            setPayload(payload);
            describeWorkspaces(OWN_WORKSPACE);
            patch({ phase: 'unlocked' });
            // Reopening counts as activity: the window restarts.
            syncKeystore(stored.derived, payload.preferences.autoLockMinutes);
            await pullAfterUnlock(keys, payload);
            return;
          } catch {
            await clearDerivedKey();
          }
        }
        patch({ phase: 'locked' });
      })();
      void warmUpGoogle();
    } else {
      patch({ phase: 'signin' });
      void warmUpGoogle();
    }
  }, [adoptVaultFile, patch, refreshBiometric, warmUpGoogle]);

  /**
   * An invite link that arrives while the app is already open.
   *
   * Changing only the fragment does not reload a page, so the state initialiser
   * never sees it — which is exactly what happens when someone pastes the link
   * into a tab that already has Keeper in it.
   */
  useEffect(() => {
    const onHash = () => {
      const invite = takePendingInvite();
      if (invite) patch({ pendingInvite: invite });
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [patch]);

  // ---- connectivity -------------------------------------------------------
  useEffect(() => {
    const update = () => patch({ online: navigator.onLine });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [patch]);

  // ---- auto-lock ----------------------------------------------------------
  const autoLockMinutes = state.payload?.preferences.autoLockMinutes ?? DEFAULT_PREFERENCES.autoLockMinutes;
  useEffect(() => {
    if (state.phase !== 'unlocked' || autoLockMinutes <= 0) return;
    let timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'focus'];
    for (const event of events) window.addEventListener(event, reset, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, reset);
    };
  }, [autoLockMinutes, lock, state.phase]);

  // Leaving the page is when inactivity really starts: restamp the stored
  // deadline so a reload inside the window reopens silently and one after it
  // asks for the password. (After a manual lock derivedRef is null and the
  // restamp clears the record instead.)
  useEffect(() => {
    if (state.phase !== 'unlocked' || autoLockMinutes <= 0) return;
    const restamp = () => syncKeystore(derivedRef.current, autoLockMinutes);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') restamp();
    };
    window.addEventListener('pagehide', restamp);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', restamp);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [autoLockMinutes, state.phase, syncKeystore]);

  // ---- keep chasing a pending sync ---------------------------------------
  /**
   * A change that could not reach the Drive is retried on its own: on a
   * growing delay, and immediately whenever the situation plausibly changed —
   * the network came back, or the person returned to the tab (which on iOS is
   * also when a backgrounded PWA wakes up).
   */
  const retrySync = useCallback(async () => {
    if (!pendingSyncRef.current || !payloadRef.current || !navigator.onLine) return;
    // Deliberately no reconnect here: this runs on a timer, and a timer has no
    // gesture to spend. If the token is gone the sync stays pending and says so.
    await runSync({ silent: true });
  }, [runSync]);

  useEffect(() => {
    if (state.phase !== 'unlocked') return;
    const tick = () => {
      window.clearTimeout(retryTimerRef.current);
      if (!pendingSyncRef.current) {
        retryTimerRef.current = window.setTimeout(tick, retryDelay(0));
        return;
      }
      void retrySync().finally(() => {
        // Back off while it keeps failing, so a long offline stretch is not a
        // request every few seconds — capped, so it always comes back.
        if (pendingSyncRef.current) retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 4);
        retryTimerRef.current = window.setTimeout(tick, retryDelay(retryAttemptRef.current));
      });
    };
    retryTimerRef.current = window.setTimeout(tick, retryDelay(0));

    const wake = () => {
      if (document.visibilityState === 'visible') void retrySync();
    };
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    document.addEventListener('visibilitychange', wake);
    return () => {
      window.clearTimeout(retryTimerRef.current);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
      document.removeEventListener('visibilitychange', wake);
    };
  }, [retrySync, state.phase]);

  // ---- flush pending writes before the tab goes away ----------------------
  useEffect(() => {
    const flush = () => {
      if (syncTimerRef.current) {
        window.clearTimeout(syncTimerRef.current);
        void runSync({ silent: true });
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [runSync]);

  const actions = useMemo<KeeperActions>(
    () => ({
      connectGoogle,
      continueOffline,
      createVault,
      unlock,
      unlockWithBiometrics,
      enableBiometrics,
      disableBiometrics,
      lock,
      saveItem,
      moveFolder,
      trashItem,
      restoreItem,
      purgeItem,
      emptyTrash,
      toggleFavorite,
      saveFolder,
      removeFolder,
      saveCustomType,
      removeCustomType,
      savePerson,
      removePerson,
      prepareAttachment,
      readAttachment,
      discardAttachment,
      updatePreferences,
      syncNow,
      changeMasterPassword,
      importBackup,
      importBundle,
      collectAttachments,
      moveToDriveFolder,
      discardOldDriveCopy,
      shareVault,
      shareVaultByLink,
      listShares,
      revokeShare,
      openSharedVault,
      redeemInvite,
      dismissInvite,
      switchWorkspace,
      forgetSharedVault: forgetShared,
      refreshSharedVault,
      sweepDriveOrphans,
      driveUsage: readDriveUsage,
      currentVaultFile,
      signOut,
      wipeDevice,
      setClientId,
      notify: (message: string) => patch({ notice: message }),
      dismissError: () => patch({ error: null }),
      dismissNotice: () => patch({ notice: null }),
    }),
    [
      changeMasterPassword,
      collectAttachments,
      connectGoogle,
      continueOffline,
      createVault,
      currentVaultFile,
      disableBiometrics,
      discardAttachment,
      emptyTrash,
      enableBiometrics,
      importBackup,
      importBundle,
      lock,
      patch,
      prepareAttachment,
      purgeItem,
      readAttachment,
      removePerson,
      restoreItem,
      saveFolder,
      moveFolder,
      removeFolder,
      saveCustomType,
      removeCustomType,
      savePerson,
      saveItem,
      setClientId,
      signOut,
      moveToDriveFolder,
      discardOldDriveCopy,
      shareVault,
      shareVaultByLink,
      listShares,
      revokeShare,
      openSharedVault,
      redeemInvite,
      dismissInvite,
      switchWorkspace,
      forgetShared,
      refreshSharedVault,
      sweepDriveOrphans,
      readDriveUsage,
      syncNow,
      toggleFavorite,
      trashItem,
      unlock,
      unlockWithBiometrics,
      updatePreferences,
      wipeDevice,
    ],
  );

  const value = useMemo(() => ({ ...state, actions }), [state, actions]);
  return <KeeperContext.Provider value={value}>{children}</KeeperContext.Provider>;
}

export function useKeeper() {
  const context = useContext(KeeperContext);
  if (!context) throw new Error('useKeeper deve ser usado dentro de <KeeperProvider>.');
  return context;
}
