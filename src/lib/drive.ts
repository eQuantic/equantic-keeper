/**
 * Google Drive appDataFolder client.
 *
 * `drive.appdata` is the narrowest scope Drive offers: the app can only see the
 * hidden per-app folder it owns, never the user's documents. The vault file is
 * ciphertext, so Google stores bytes it cannot read.
 */
import type { GoogleAuth } from './google-auth';
import { isVaultFile, type VaultFile } from './vault';

export const VAULT_FILE_NAME = 'vault.keeper.json';
const BACKUP_PREFIX = 'backup-';
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const FILES_API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const FILE_FIELDS = 'id,name,modifiedTime,size,headRevisionId';

export interface DriveFileMeta {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
  headRevisionId?: string;
}

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
  constructor(private readonly auth: GoogleAuth) {}

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

  async listAppData(query?: string): Promise<DriveFileMeta[]> {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      fields: `files(${FILE_FIELDS})`,
      pageSize: '50',
      orderBy: 'modifiedTime desc',
    });
    if (query) params.set('q', query);
    const response = await this.request(`${FILES_API}?${params}`);
    const data = (await response.json()) as { files?: DriveFileMeta[] };
    return data.files ?? [];
  }

  async findVault(): Promise<DriveFileMeta | null> {
    const files = await this.listAppData(`name = '${VAULT_FILE_NAME}' and trashed = false`);
    return files[0] ?? null;
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
      `${JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json' })}\r\n` +
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
      body: JSON.stringify({ name, parents: ['appDataFolder'], mimeType }),
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
    const backups = (await this.listAppData(`name contains '${BACKUP_PREFIX}' and trashed = false`)).filter((f) =>
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
