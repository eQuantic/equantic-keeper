/**
 * Google Drive client.
 *
 * The vault lives in one of two places, and the difference is not cosmetic.
 * `drive.appdata` is the narrowest scope Drive offers — a hidden per-app folder
 * the user never sees — but Drive refuses to share anything kept there, with
 * anyone, ever. A normal folder created by the app under `drive.file` is
 * shareable, still keeps the app blind to every other file in the account, and
 * shows up in My Drive where the user can see what this app is costing them.
 *
 * Either way what is stored is ciphertext, so Google holds bytes it cannot
 * read — and so does anyone the folder is later shared with, unless they also
 * hold a key.
 */
import type { GoogleAuth } from './google-auth';
import { isVaultFile, type VaultFile } from './vault';

export const VAULT_FILE_NAME = 'vault.keeper.json';
/** What the folder is called in My Drive, once the user moves out of appData. */
export const KEEPER_FOLDER_NAME = 'eQuantic Keeper';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const BACKUP_PREFIX = 'backup-';
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FILE_FIELDS = 'id,name,modifiedTime,size,headRevisionId';
const ABOUT_API = 'https://www.googleapis.com/drive/v3/about';

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
  headRevisionId?: string;
}

/**
 * Where a client reads and writes: the hidden app folder, or a folder of the
 * user's own. Everything else about the client is identical.
 */
export type DriveSpace = { kind: 'appdata' } | { kind: 'folder'; id: string };

export interface RemoteVault {
  meta: DriveFileMeta;
  file: VaultFile;
}

export class DriveError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'DriveError';
  }
}

/** The slice attachments depend on — binary in, binary out. */
export interface DriveBlobApi {
  createBlob(name: string, bytes: Uint8Array, mimeType?: string): Promise<DriveFileMeta>;
  downloadBlob(fileId: string): Promise<Uint8Array>;
  delete(fileId: string): Promise<void>;
}

/**
 * The slice of Drive the sync engine depends on. Depending on the interface
 * rather than the concrete client keeps `sync.ts` testable against an in-memory
 * double, with no network and no casts.
 */
export interface DriveApi {
  findVault(): Promise<DriveFileMeta | null>;
  getMeta(fileId: string): Promise<DriveFileMeta>;
  download(fileId: string): Promise<VaultFile>;
  fetchVault(): Promise<RemoteVault | null>;
  create(name: string, file: VaultFile): Promise<DriveFileMeta>;
  update(fileId: string, file: VaultFile): Promise<DriveFileMeta>;
  rotateBackups(file: VaultFile): Promise<void>;
}

export class DriveClient implements DriveApi, DriveBlobApi {
  constructor(
    private readonly auth: GoogleAuth,
    private location: DriveSpace = { kind: 'appdata' },
  ) {}

  get space(): DriveSpace {
    return this.location;
  }

  /** Points this client at another space, from the next request on. */
  useSpace(space: DriveSpace): void {
    this.location = space;
  }

  /**
   * A second client on the same account, reading somewhere else. The migration
   * needs to hold both spaces open at once, and passing two clients around is
   * plainer than moving one back and forth mid-copy.
   */
  withSpace(space: DriveSpace): DriveClient {
    return new DriveClient(this.auth, space);
  }

  /** The parent a new file is created under, in whichever space we are in. */
  private parents(): string[] {
    return [this.location.kind === 'appdata' ? 'appDataFolder' : this.location.id];
  }

  /**
   * Scopes a listing to the current space. In the app folder that is the
   * `spaces` parameter; in a normal folder it is a parent clause, because the
   * default `drive` space is the whole account — and under `drive.file` the
   * account is only ever the handful of files this app made.
   */
  private scoped(params: URLSearchParams, query?: string): URLSearchParams {
    const clauses: string[] = [];
    if (this.location.kind === 'appdata') params.set('spaces', 'appDataFolder');
    else clauses.push(`'${this.location.id}' in parents`);
    if (query) clauses.push(`(${query})`);
    if (clauses.length) params.set('q', clauses.join(' and '));
    return params;
  }

  /** Adds auth, retries once with a fresh token when the current one is stale. */
  private async request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.auth.requestToken(false);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch {
      throw new DriveError('Sem conexão com o Google Drive.');
    }

    if (response.status === 401 && retry) {
      this.auth.invalidate();
      return this.request(url, init, false);
    }
    if (!response.ok) {
      throw new DriveError(await describeError(response), response.status);
    }
    return response;
  }

  async listFiles(query?: string): Promise<DriveFileMeta[]> {
    const params = this.scoped(
      new URLSearchParams({
        fields: `files(${FILE_FIELDS})`,
        pageSize: '50',
        orderBy: 'modifiedTime desc',
      }),
      query,
    );
    const response = await this.request(`${FILES_API}?${params}`);
    const data = (await response.json()) as { files?: DriveFileMeta[] };
    return data.files ?? [];
  }

  /** Every file in this space, following Drive's paging to the end. */
  async listAll(): Promise<DriveFileMeta[]> {
    const all: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    do {
      const params = this.scoped(
        new URLSearchParams({
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '1000',
        }),
        'trashed = false',
      );
      if (pageToken) params.set('pageToken', pageToken);
      const response = await this.request(`${FILES_API}?${params}`);
      const data = (await response.json()) as { files?: DriveFileMeta[]; nextPageToken?: string };
      all.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return all;
  }

  /**
   * The account's storage totals, or null. The Drive scopes do not always
   * carry the right to ask, and this is context, not the answer — so a refusal
   * is silent rather than an error in the user's face.
   */
  async storageQuota(): Promise<{ used: number; limit: number } | null> {
    try {
      const response = await this.request(`${ABOUT_API}?fields=storageQuota`);
      const data = (await response.json()) as {
        storageQuota?: { usage?: string; limit?: string };
      };
      const used = Number(data.storageQuota?.usage ?? NaN);
      const limit = Number(data.storageQuota?.limit ?? NaN);
      if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
      return { used, limit };
    } catch {
      return null;
    }
  }

  async findVault(): Promise<DriveFileMeta | null> {
    const files = await this.listFiles(`name = '${VAULT_FILE_NAME}' and trashed = false`);
    return files[0] ?? null;
  }

  /**
   * The app's own folder in My Drive, if it exists. Under `drive.file` a
   * listing only ever returns files this app created, so a folder the user
   * happens to have named the same is invisible here and cannot be picked up
   * by accident.
   */
  async findFolder(name = KEEPER_FOLDER_NAME): Promise<DriveFileMeta | null> {
    const params = new URLSearchParams({
      q: `name = '${name}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
      fields: `files(${FILE_FIELDS})`,
      pageSize: '10',
    });
    const response = await this.request(`${FILES_API}?${params}`);
    const data = (await response.json()) as { files?: DriveFileMeta[] };
    return data.files?.[0] ?? null;
  }

  /** Creates it in My Drive — no parent, so the user finds it where they look. */
  async createFolder(name = KEEPER_FOLDER_NAME): Promise<DriveFileMeta> {
    const response = await this.request(`${FILES_API}?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
    });
    return (await response.json()) as DriveFileMeta;
  }

  async ensureFolder(name = KEEPER_FOLDER_NAME): Promise<DriveFileMeta> {
    return (await this.findFolder(name)) ?? (await this.createFolder(name));
  }

  async getMeta(fileId: string): Promise<DriveFileMeta> {
    const response = await this.request(`${FILES_API}/${fileId}?fields=${FILE_FIELDS}`);
    return (await response.json()) as DriveFileMeta;
  }

  async download(fileId: string): Promise<VaultFile> {
    const response = await this.request(`${FILES_API}/${fileId}?alt=media`);
    const raw: unknown = await response.json().catch(() => null);
    if (!isVaultFile(raw)) {
      throw new DriveError('O arquivo no Drive não é um cofre válido do Keeper.');
    }
    return raw;
  }

  async fetchVault(): Promise<RemoteVault | null> {
    const meta = await this.findVault();
    if (!meta) return null;
    return { meta, file: await this.download(meta.id) };
  }

  async create(name: string, file: VaultFile): Promise<DriveFileMeta> {
    const boundary = `keeper-${crypto.randomUUID()}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name, parents: this.parents(), mimeType: 'application/json' })}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(file)}\r\n--${boundary}--`;

    const response = await this.request(`${UPLOAD_API}?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await response.json()) as DriveFileMeta;
  }

  async update(fileId: string, file: VaultFile): Promise<DriveFileMeta> {
    const response = await this.request(`${UPLOAD_API}/${fileId}?uploadType=media&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    });
    return (await response.json()) as DriveFileMeta;
  }

  async delete(fileId: string): Promise<void> {
    await this.request(`${FILES_API}/${fileId}`, { method: 'DELETE' });
  }

  /**
   * Uploads raw bytes as a new file in the app folder.
   *
   * Two requests instead of a multipart one: `uploadType=media` cannot carry
   * metadata, and hand-assembling a multipart body around binary content means
   * turning the bytes into a string first — which is exactly how a scan gets
   * corrupted. Creating the (empty) file first and PATCHing the content keeps
   * the bytes untouched.
   */
  async createBlob(name: string, bytes: Uint8Array, mimeType = 'application/octet-stream'): Promise<DriveFileMeta> {
    const created = await this.request(`${FILES_API}?fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: this.parents(), mimeType }),
    });
    const meta = (await created.json()) as DriveFileMeta;
    return this.updateBlob(meta.id, bytes, mimeType);
  }

  async updateBlob(fileId: string, bytes: Uint8Array, mimeType = 'application/octet-stream'): Promise<DriveFileMeta> {
    const response = await this.request(`${UPLOAD_API}/${fileId}?uploadType=media&fields=${FILE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: bytes.slice().buffer as ArrayBuffer,
    });
    return (await response.json()) as DriveFileMeta;
  }

  async downloadBlob(fileId: string): Promise<Uint8Array> {
    const response = await this.request(`${FILES_API}/${fileId}?alt=media`);
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Keeps a rolling set of daily snapshots inside the same hidden folder, so a
   * bad merge or an accidental "delete everything" stays recoverable.
   */
  async rotateBackups(file: VaultFile): Promise<void> {
    const backups = (await this.listFiles(`name contains '${BACKUP_PREFIX}' and trashed = false`)).filter((f) =>
      f.name.startsWith(BACKUP_PREFIX),
    );
    const newest = backups[0];
    if (newest && Date.now() - Date.parse(newest.modifiedTime) < BACKUP_INTERVAL_MS) return;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this.create(`${BACKUP_PREFIX}${stamp}.json`, file);

    for (const stale of backups.slice(MAX_BACKUPS - 1)) {
      await this.delete(stale.id).catch(() => undefined);
    }
  }
}

export interface DriveUsage {
  /** Bytes, by what the file is for. */
  vault: number;
  backups: number;
  attachments: number;
  other: number;
  total: number;
  files: number;
  /** The account's own quota, when Drive tells us — it is not always allowed. */
  quota?: { used: number; limit: number };
}

export const ATTACHMENT_PREFIX = 'attachment-';

/**
 * Everything Keeper keeps in the Drive, counted.
 *
 * The app folder is invisible in the Drive UI, so the only way to know what
 * this app costs an account is to add it up here — pages included, because a
 * vault with a few hundred scans has more than one page of files. In a normal
 * folder the user could count it themselves, but the breakdown by purpose is
 * still ours to give.
 */
export async function driveUsage(client: DriveClient): Promise<DriveUsage> {
  const usage: DriveUsage = { vault: 0, backups: 0, attachments: 0, other: 0, total: 0, files: 0 };
  for (const file of await client.listAll()) {
    const size = Number(file.size ?? 0);
    if (!Number.isFinite(size)) continue;
    usage.files += 1;
    usage.total += size;
    if (file.name === VAULT_FILE_NAME) usage.vault += size;
    else if (file.name.startsWith(BACKUP_PREFIX)) usage.backups += size;
    else if (file.name.startsWith(ATTACHMENT_PREFIX)) usage.attachments += size;
    else usage.other += size;
  }
  const quota = await client.storageQuota();
  return quota ? { ...usage, quota } : usage;
}

async function describeError(response: Response): Promise<string> {
  const fallback = `Google Drive respondeu ${response.status}.`;
  try {
    const data = (await response.json()) as { error?: { message?: string } };
    const message = data.error?.message;
    if (!message) return fallback;
    if (response.status === 403 && /insufficient/i.test(message)) {
      return 'Permissão insuficiente no Drive. Refaça o login concedendo o acesso à pasta do aplicativo.';
    }
    return `${message} (HTTP ${response.status})`;
  } catch {
    return fallback;
  }
}
