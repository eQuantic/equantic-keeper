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
import {
  deriveKey,
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
import { DriveClient } from '../lib/drive';
import { GoogleAuth, GoogleAuthError } from '../lib/google-auth';
import type { AttachmentRef, Person, VaultItem } from '../lib/model';
import {
  cacheAttachment,
  encryptAttachment,
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
  sealVault,
  unlockVault,
  unlockVaultWithDerived,
  type VaultFile,
  type VaultPayload,
  type VaultPreferences,
} from '../lib/vault';
import * as storage from '../lib/storage';
import { pullVault, syncVault, VaultPasswordMismatchError } from '../lib/sync';
import { parseBundle, readBackup, referencedAttachments } from '../lib/backup';
import { clearClipboard } from '../lib/clipboard';

export type Phase = 'boot' | 'config' | 'signin' | 'create' | 'locked' | 'unlocked';
export type SyncStatus = 'idle' | 'syncing' | 'saved' | 'offline' | 'error' | 'conflict';

export interface KeeperState {
  phase: Phase;
  busy: boolean;
  error: string | null;
  notice: string | null;
  account: storage.RememberedAccount | null;
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
  trashItem(id: string): Promise<void>;
  restoreItem(id: string): Promise<void>;
  purgeItem(id: string): Promise<void>;
  emptyTrash(): Promise<void>;
  toggleFavorite(id: string): Promise<void>;
  savePerson(person: Person): Promise<void>;
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

export function KeeperProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<KeeperState>(() => ({
    phase: 'boot',
    busy: false,
    error: null,
    notice: null,
    account: storage.loadAccount(),
    connected: false,
    online: navigator.onLine,
    payload: null,
    hasLocalVault: !!storage.loadCachedVault(),
    sync: { status: 'idle' },
    biometricAvailable: false,
    biometricEnrolled: !!storage.loadBiometricRecord(),
    biometricReady: false,
  }));

  const authRef = useRef<GoogleAuth | null>(null);
  const driveRef = useRef<DriveClient | null>(null);
  const derivedRef = useRef<DerivedKey | null>(null);
  const payloadRef = useRef<VaultPayload | null>(null);
  const fileRef = useRef<VaultFile | null>(null);
  const driveIdRef = useRef<string | undefined>(undefined);
  const revisionRef = useRef<string | undefined>(undefined);
  const syncTimerRef = useRef<number | undefined>(undefined);
  const bootedRef = useRef(false);

  const patch = useCallback((next: Partial<KeeperState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

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
      patch({ payload });
    },
    [patch],
  );

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
      authRef.current = new GoogleAuth(clientId);
      driveRef.current = new DriveClient(authRef.current);
    }
    return { auth: authRef.current, drive: driveRef.current! };
  }, []);

  /** Persist the encrypted vault locally so the app works offline. */
  const persistLocal = useCallback(async (payload: VaultPayload) => {
    const derived = derivedRef.current;
    if (!derived) return null;
    const file = await sealVault(derived, payload);
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
      const payload = payloadRef.current;
      const drive = driveRef.current;
      const auth = authRef.current;
      if (!derived || !payload) return;
      if (!drive || !auth?.isSignedIn || !navigator.onLine) {
        patch({ sync: { status: 'offline', message: 'Alterações salvas apenas neste dispositivo.' } });
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
        patch({ sync: { status: 'error', message } });
        if (!options.silent) patch({ error: message });
      }
    },
    [patch, pushPendingAttachments, setPayload],
  );

  const scheduleSync = useCallback(() => {
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
      const next = updater(current);
      setPayload(next);
      await persistLocal(next);
      scheduleSync();
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

  const connectGoogle = useCallback(
    async (interactive = true) => {
      // A silent renewal runs in the background: it must never put the unlock
      // button into a loading state the user cannot dismiss.
      patch({ busy: interactive, error: null });
      try {
        const { auth, drive } = services();
        await auth.requestToken(interactive);
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
          // Silent renewal failed: stay where we are and let the user click.
          patch({ busy: false, connected: false });
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
        const { derived, file } = await buildVault(password, emptyPayload());
        derivedRef.current = derived;
        adoptVaultFile(file);
        setPayload(emptyPayload());
        storage.saveCachedVault({ file, cachedAt: new Date().toISOString() });
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
    async (derived: DerivedKey, payload: VaultPayload) => {
      if (!authRef.current?.isSignedIn || !navigator.onLine) return;
      try {
        const remote = await pullVault({
          drive: driveRef.current!,
          derived,
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
        const { derived, payload } = await unlockVault(file, password);
        derivedRef.current = derived;
        setPayload(payload);
        patch({ phase: 'unlocked', busy: false });
        await pullAfterUnlock(derived, payload);
      } catch (error) {
        fail(error, 'Não foi possível desbloquear o cofre.');
      }
    },
    [fail, patch, pullAfterUnlock, setPayload],
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
      const { payload } = await unlockVaultWithDerived(file, derived);
      derivedRef.current = derived;
      setPayload(payload);
      patch({ phase: 'unlocked', busy: false });
      await pullAfterUnlock(derived, payload);
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
    derivedRef.current = null;
    payloadRef.current = null;
    void clearClipboard();
    setState((current) => ({
      ...current,
      phase: current.hasLocalVault || fileRef.current ? 'locked' : 'signin',
      payload: null,
      error: null,
      notice: null,
    }));
  }, []);

  const touchItem = (item: VaultItem): VaultItem => ({ ...item, updatedAt: new Date().toISOString() });

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
    const derived = derivedRef.current;
    if (!derived) throw new Error('O cofre está bloqueado.');
    const { ref, ciphertext } = await encryptAttachment(derived.key, file);
    await cacheAttachment(ref, ciphertext);
    return ref;
  }, []);

  const readAttachment = useCallback(async (ref: AttachmentRef) => {
    const derived = derivedRef.current;
    if (!derived) throw new Error('O cofre está bloqueado.');
    return openAttachment(driveRef.current, derived.key, ref);
  }, []);

  const discardAttachment = useCallback(
    (ref: AttachmentRef) => forgetAttachment(driveRef.current, ref),
    [],
  );

  const updatePreferences = useCallback(
    (prefs: Partial<VaultPreferences>) =>
      mutate((payload) => ({ ...payload, preferences: { ...payload.preferences, ...prefs } })),
    [mutate],
  );

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

        const { derived, file: rebuilt } = await buildVault(next, payload);
        derivedRef.current = derived;
        fileRef.current = rebuilt;
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
      const { payload: imported } = await unlockVault(bundle.file, password);

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
  const sweepDriveOrphans = useCallback(async () => {
    const drive = driveRef.current;
    const payload = payloadRef.current;
    if (!drive || !payload) throw new Error('Conecte a conta Google para liberar espaço.');

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
      patch({
        phase: storage.loadCachedVault() ? 'locked' : 'signin',
        error: null,
        notice: 'Client ID salvo neste navegador.',
      });
    },
    [patch],
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
      patch({ phase: 'locked' });
      void connectGoogle(false);
    } else {
      patch({ phase: 'signin' });
      void connectGoogle(false).then(() => {
        // A silent connect that found a vault already moved us to 'locked'.
      });
    }
  }, [adoptVaultFile, connectGoogle, patch, refreshBiometric]);

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
      trashItem,
      restoreItem,
      purgeItem,
      emptyTrash,
      toggleFavorite,
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
      sweepDriveOrphans,
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
      savePerson,
      saveItem,
      setClientId,
      signOut,
      sweepDriveOrphans,
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
