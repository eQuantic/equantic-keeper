/**
 * OneDrive, through Microsoft Graph.
 *
 * The second implementation of `VaultStorage`, and the one that proves the
 * interface was worth naming: sync, attachments and migration reach this file
 * without knowing it exists.
 *
 * Two places, as with Drive. `special/approot` is the app's own folder — the
 * counterpart of `appDataFolder`, invisible in OneDrive's own listing and
 * reachable by nothing else. A normal folder is the other, for when a vault has
 * to be somewhere a person can see.
 *
 * Sharing is not implemented here yet, and `shares` says so: Graph can invite
 * an account to an item, but the guest half — finding a folder someone shared
 * with you — has its own rules, and half a sharing feature is worse than none.
 */
import type { MicrosoftAuth } from './ms-auth';
import { isVaultFile, type VaultFile } from './vault';
import type {
  RemoteVaultFile,
  StorageSpace,
  StoredFileMeta,
  VaultStorage,
} from './storage-provider';
import { KEEPER_FOLDER_NAME, VAULT_FILE_NAME } from './drive';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const BACKUP_PREFIX = 'backup-';
const MAX_BACKUPS = 5;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** What Graph returns for an item, of which we use very little. */
interface GraphItem {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  eTag?: string;
  cTag?: string;
  folder?: { childCount?: number };
}

export class OneDriveError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'OneDriveError';
  }
}

function asMeta(item: GraphItem): StoredFileMeta {
  return {
    id: item.id,
    name: item.name,
    modifiedTime: item.lastModifiedDateTime ?? '',
    ...(item.size === undefined ? {} : { size: String(item.size) }),
    // cTag changes with the CONTENT, eTag with the metadata too. Sync compares
    // revisions to decide whether the remote copy moved, and a rename is not a
    // change worth merging over.
    ...(item.cTag ? { headRevisionId: item.cTag } : {}),
  };
}

export class OneDriveClient implements VaultStorage {
  readonly id = 'microsoft' as const;
  readonly label = 'OneDrive';
  /** Graph can invite an account, but the guest half is not built. */
  readonly shares = false;

  constructor(
    private readonly auth: MicrosoftAuth,
    private location: StorageSpace = { kind: 'appdata' },
  ) {}

  get space(): StorageSpace {
    return this.location;
  }

  useSpace(space: StorageSpace): void {
    this.location = space;
  }

  withSpace(space: StorageSpace): OneDriveClient {
    return new OneDriveClient(this.auth, space);
  }

  /** The Graph path prefix for whichever space this client is pointed at. */
  private root(): string {
    return this.location.kind === 'appdata'
      ? `${GRAPH}/me/drive/special/approot`
      : `${GRAPH}/me/drive/items/${this.location.id}`;
  }

  /**
   * Adds auth, and retries once with a fresh token after a 401 — the same
   * contract the Drive client keeps, so the layers above cannot tell them
   * apart.
   */
  private async request(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.auth.requestToken(false);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch {
      throw new OneDriveError('Sem conexão com o OneDrive.');
    }

    if (response.status === 401 && retry) {
      this.auth.invalidate();
      return this.request(url, init, false);
    }
    if (!response.ok) throw new OneDriveError(await describeError(response), response.status);
    return response;
  }

  private async children(): Promise<GraphItem[]> {
    const all: GraphItem[] = [];
    let url: string | undefined = `${this.root()}/children?$top=200&$select=id,name,size,lastModifiedDateTime,cTag,folder`;
    while (url) {
      const response = await this.request(url);
      const page = (await response.json()) as { value?: GraphItem[]; '@odata.nextLink'?: string };
      all.push(...(page.value ?? []));
      url = page['@odata.nextLink'];
    }
    return all;
  }

  async listAll(): Promise<StoredFileMeta[]> {
    return (await this.children()).map(asMeta);
  }

  /**
   * Graph has no query language like Drive's, so the filtering happens here.
   * Only two shapes are ever asked for — a name, and a prefix — and both are
   * cheaper to match locally than to translate into `$filter`, which OneDrive
   * personal accounts support only partially.
   */
  async listFiles(query?: string): Promise<StoredFileMeta[]> {
    const files = await this.listAll();
    if (!query) return files;
    const exact = /name\s*=\s*'([^']+)'/.exec(query)?.[1];
    if (exact) return files.filter((file) => file.name === exact);
    const contains = /name contains '([^']+)'/.exec(query)?.[1];
    if (contains) return files.filter((file) => file.name.includes(contains));
    return files;
  }

  async findVault(): Promise<StoredFileMeta | null> {
    return (await this.listFiles(`name = '${VAULT_FILE_NAME}'`))[0] ?? null;
  }

  async getMeta(fileId: string): Promise<StoredFileMeta> {
    const response = await this.request(`${GRAPH}/me/drive/items/${fileId}?$select=id,name,size,lastModifiedDateTime,cTag`);
    return asMeta((await response.json()) as GraphItem);
  }

  async download(fileId: string): Promise<VaultFile> {
    const response = await this.request(`${GRAPH}/me/drive/items/${fileId}/content`);
    const raw: unknown = await response.json().catch(() => null);
    if (!isVaultFile(raw)) throw new OneDriveError('O arquivo no OneDrive não é um cofre válido do Keeper.');
    return raw;
  }

  async fetchVault(): Promise<RemoteVaultFile | null> {
    const meta = await this.findVault();
    if (!meta) return null;
    return { meta, file: await this.download(meta.id) };
  }

  /**
   * Writing by name rather than by id: Graph addresses a file inside a folder
   * by path, which creates it when it is not there and replaces it when it is.
   * One call for both cases, and no lost race between a check and a write.
   */
  async create(name: string, file: unknown): Promise<StoredFileMeta> {
    const response = await this.request(`${this.root()}:/${encodeURIComponent(name)}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    });
    return asMeta((await response.json()) as GraphItem);
  }

  async update(fileId: string, file: unknown): Promise<StoredFileMeta> {
    const response = await this.request(`${GRAPH}/me/drive/items/${fileId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(file),
    });
    return asMeta((await response.json()) as GraphItem);
  }

  async delete(fileId: string): Promise<void> {
    await this.request(`${GRAPH}/me/drive/items/${fileId}`, { method: 'DELETE' });
  }

  async readJson<T>(
    name: string,
    guard: (value: unknown) => value is T,
  ): Promise<{ meta: StoredFileMeta; value: T } | null> {
    const [meta] = await this.listFiles(`name = '${name}'`);
    if (!meta) return null;
    return { meta, value: await this.readJsonById(meta.id, guard) };
  }

  async readJsonById<T>(fileId: string, guard: (value: unknown) => value is T): Promise<T> {
    const response = await this.request(`${GRAPH}/me/drive/items/${fileId}/content`);
    const raw: unknown = await response.json().catch(() => null);
    if (!guard(raw)) throw new OneDriveError('O arquivo no OneDrive não está no formato esperado.');
    return raw;
  }

  async writeJson(name: string, value: unknown, fileId?: string): Promise<StoredFileMeta> {
    return fileId ? this.update(fileId, value) : this.create(name, value);
  }

  async createBlob(name: string, bytes: Uint8Array, mimeType = 'application/octet-stream'): Promise<StoredFileMeta> {
    const response = await this.request(`${this.root()}:/${encodeURIComponent(name)}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: bytes.slice().buffer as ArrayBuffer,
    });
    return asMeta((await response.json()) as GraphItem);
  }

  async updateBlob(fileId: string, bytes: Uint8Array, mimeType = 'application/octet-stream'): Promise<StoredFileMeta> {
    const response = await this.request(`${GRAPH}/me/drive/items/${fileId}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: bytes.slice().buffer as ArrayBuffer,
    });
    return asMeta((await response.json()) as GraphItem);
  }

  async downloadBlob(fileId: string): Promise<Uint8Array> {
    const response = await this.request(`${GRAPH}/me/drive/items/${fileId}/content`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async findFolder(name = KEEPER_FOLDER_NAME): Promise<StoredFileMeta | null> {
    try {
      const response = await this.request(
        `${GRAPH}/me/drive/root:/${encodeURIComponent(name)}?$select=id,name,size,lastModifiedDateTime,cTag,folder`,
      );
      return asMeta((await response.json()) as GraphItem);
    } catch (error) {
      // Not being there is an answer, not a failure.
      if (error instanceof OneDriveError && error.status === 404) return null;
      throw error;
    }
  }

  async createFolder(name = KEEPER_FOLDER_NAME): Promise<StoredFileMeta> {
    const response = await this.request(`${GRAPH}/me/drive/root/children`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        folder: {},
        // Two devices creating it at once should end up with one folder, not
        // with "eQuantic Keeper 1" beside it.
        '@microsoft.graph.conflictBehavior': 'fail',
      }),
    });
    return asMeta((await response.json()) as GraphItem);
  }

  async ensureFolder(name = KEEPER_FOLDER_NAME): Promise<StoredFileMeta> {
    const existing = await this.findFolder(name);
    if (existing) return existing;
    try {
      return await this.createFolder(name);
    } catch (error) {
      // Lost the race: whoever won made the folder we wanted.
      if (error instanceof OneDriveError && error.status === 409) {
        const found = await this.findFolder(name);
        if (found) return found;
      }
      throw error;
    }
  }

  async storageQuota(): Promise<{ used: number; limit: number } | null> {
    try {
      const response = await this.request(`${GRAPH}/me/drive?$select=quota`);
      const data = (await response.json()) as { quota?: { used?: number; total?: number } };
      const used = data.quota?.used;
      const limit = data.quota?.total;
      if (typeof used !== 'number' || typeof limit !== 'number') return null;
      return { used, limit };
    } catch {
      return null;
    }
  }

  /** Daily snapshots beside the vault, on the same terms as on Drive. */
  async rotateBackups(file: VaultFile): Promise<void> {
    const backups = (await this.listFiles(`name contains '${BACKUP_PREFIX}'`))
      .filter((entry) => entry.name.startsWith(BACKUP_PREFIX))
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));

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
  const fallback = `O OneDrive respondeu ${response.status}.`;
  try {
    const data = (await response.json()) as { error?: { message?: string; code?: string } };
    const message = data.error?.message;
    if (!message) return fallback;
    if (response.status === 403) {
      return 'Permissão insuficiente no OneDrive. Refaça o login concedendo o acesso à pasta do aplicativo.';
    }
    return `${message} (HTTP ${response.status})`;
  } catch {
    return fallback;
  }
}
