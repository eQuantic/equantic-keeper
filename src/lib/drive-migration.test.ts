import { describe, expect, it } from 'vitest';
import {
  MOVED_MARKER_NAME,
  discardAppDataCopy,
  migrateToFolder,
  readMovedMarker,
  repointAttachments,
  type MigrationDrive,
} from './drive-migration';
import { KEEPER_FOLDER_NAME, VAULT_FILE_NAME, type DriveFileMeta, type DriveSpace } from './drive';
import { emptyPayload, type VaultPayload } from './vault';
import type { AttachmentRef, VaultItem } from './model';

interface StoredFile {
  id: string;
  name: string;
  space: string;
  bytes: Uint8Array;
}

/**
 * In-memory Drive with two spaces. Files carry real bytes, so a copy that
 * silently produces an empty file fails the test rather than passing it.
 */
class FakeDrive implements MigrationDrive {
  readonly files: StoredFile[] = [];
  private next = 1;
  /** Names whose download blows up, standing in for a file Drive will not give. */
  unreadable = new Set<string>();

  constructor(private readonly current: string = 'appdata') {}

  private key(space: DriveSpace): string {
    return space.kind === 'appdata' ? 'appdata' : `folder:${space.id}`;
  }

  seed(name: string, bytes: Uint8Array, space = 'appdata'): StoredFile {
    const file = { id: `f${this.next++}`, name, space, bytes };
    this.files.push(file);
    return file;
  }

  withSpace(space: DriveSpace): MigrationDrive {
    const clone = Object.create(this) as FakeDrive;
    Object.defineProperty(clone, 'current', { value: this.key(space) });
    return clone;
  }

  async listAll(): Promise<DriveFileMeta[]> {
    return this.files
      .filter((file) => file.space === this.current)
      .map((file) => ({
        id: file.id,
        name: file.name,
        modifiedTime: '2026-01-01T00:00:00Z',
        size: String(file.bytes.length),
      }));
  }

  async downloadBlob(fileId: string): Promise<Uint8Array> {
    const file = this.files.find((f) => f.id === fileId);
    if (!file) throw new Error(`inexistente: ${fileId}`);
    if (this.unreadable.has(file.name)) throw new Error('Drive recusou o arquivo.');
    return file.bytes;
  }

  async createBlob(name: string, bytes: Uint8Array): Promise<DriveFileMeta> {
    const file = this.seed(name, bytes, this.current);
    return { id: file.id, name, modifiedTime: '2026-01-01T00:00:00Z', size: String(bytes.length) };
  }

  async delete(fileId: string): Promise<void> {
    const index = this.files.findIndex((f) => f.id === fileId);
    if (index >= 0) this.files.splice(index, 1);
  }

  async ensureFolder(name = KEEPER_FOLDER_NAME): Promise<DriveFileMeta> {
    const existing = this.files.find((f) => f.name === name && f.space === 'drive');
    if (existing) return { id: existing.id, name, modifiedTime: '2026-01-01T00:00:00Z' };
    const created = this.seed(name, new Uint8Array(), 'drive');
    return { id: created.id, name, modifiedTime: '2026-01-01T00:00:00Z' };
  }

  inFolder(folderId: string): StoredFile[] {
    return this.files.filter((f) => f.space === `folder:${folderId}`);
  }
}

const bytes = (text: string) => new TextEncoder().encode(text);

function withAttachment(driveFileId: string, id = 'a1'): VaultPayload {
  const ref = { id, name: 'scan.pdf', mimeType: 'application/pdf', size: 3, driveFileId } as AttachmentRef;
  const item = { id: 'item-1', attachments: [ref] } as VaultItem;
  return { ...emptyPayload(), items: [item] };
}

describe('migração para uma pasta do Drive', () => {
  it('copia tudo e diz onde cada anexo foi parar', async () => {
    const drive = new FakeDrive();
    const vault = drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    const scan = drive.seed('attachment-a1.bin', bytes('pdf'));
    drive.seed('backup-2026-01-01.json', bytes('{"backup":1}'));

    const report = await migrateToFolder(drive);

    expect(report.copied).toBe(3);
    expect(report.skipped).toBe(0);
    expect(report.failed).toEqual([]);
    expect(report.vaultFileId).not.toBe(vault.id);
    expect(report.moved.get(scan.id)).toBeDefined();

    const copied = drive.inFolder(report.folderId);
    expect(copied.map((f) => f.name).sort()).toEqual([
      'attachment-a1.bin',
      'backup-2026-01-01.json',
      VAULT_FILE_NAME,
    ]);
    // Os bytes têm de chegar iguais: um anexo truncado é um documento perdido.
    expect(copied.find((f) => f.name === 'attachment-a1.bin')?.bytes).toEqual(bytes('pdf'));
  });

  it('não apaga nada da pasta oculta', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    drive.seed('attachment-a1.bin', bytes('pdf'));

    const report = await migrateToFolder(drive);

    const left = drive.files.filter((f) => f.space === 'appdata').map((f) => f.name);
    expect(left.sort()).toEqual([MOVED_MARKER_NAME, 'attachment-a1.bin', VAULT_FILE_NAME].sort());
    expect(report.copied).toBe(2);
  });

  it('rodar de novo não duplica o que já foi copiado', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    const scan = drive.seed('attachment-a1.bin', bytes('pdf'));

    const first = await migrateToFolder(drive);
    const second = await migrateToFolder(drive);

    expect(second.copied).toBe(0);
    expect(second.skipped).toBe(2);
    expect(second.folderId).toBe(first.folderId);
    // E continua a saber para onde o anexo foi, senão o cofre ficaria a
    // apontar para a pasta antiga depois de uma retomada.
    expect(second.moved.get(scan.id)).toBe(first.moved.get(scan.id));
    // Nem o marcador é copiado para lá: a pasta nova tem cofre e anexo, e mais nada.
    expect(drive.inFolder(first.folderId)).toHaveLength(2);
  });

  it('um arquivo ilegível não impede os outros', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    drive.seed('attachment-a1.bin', bytes('pdf'));
    drive.seed('attachment-a2.bin', bytes('outro'));
    drive.unreadable.add('attachment-a1.bin');

    const report = await migrateToFolder(drive);

    expect(report.failed).toEqual(['attachment-a1.bin']);
    expect(report.copied).toBe(2);
    expect(report.vaultFileId).not.toBeNull();
  });

  it('copia o cofre por último', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    drive.seed('attachment-a1.bin', bytes('pdf'));

    const seen: string[] = [];
    const report = await migrateToFolder(drive, (progress) => seen.push(progress.name));

    expect(seen.at(-1)).toBe(VAULT_FILE_NAME);
    expect(seen).toHaveLength(2);
    expect(readMovedMarker(await drive.listAll())).toBe(true);
    expect(report.bytes).toBeGreaterThan(0);
  });
});

describe('repointAttachments', () => {
  it('reaponta os anexos copiados', () => {
    const payload = withAttachment('antigo');
    const { payload: next, changed } = repointAttachments(payload, new Map([['antigo', 'novo']]));

    expect(changed).toBe(1);
    expect(next.items[0]!.attachments[0]!.driveFileId).toBe('novo');
    // O original não é tocado: o estado só muda quando o chamador o salva.
    expect(payload.items[0]!.attachments[0]!.driveFileId).toBe('antigo');
  });

  it('deixa como está o anexo que não foi copiado', () => {
    const payload = withAttachment('ficou-para-trás');
    const { payload: next, changed } = repointAttachments(payload, new Map([['outro', 'novo']]));

    expect(changed).toBe(0);
    expect(next).toBe(payload);
  });
});

describe('marcador de mudança', () => {
  it('avisa a pasta oculta que o cofre mudou de lugar', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));

    await migrateToFolder(drive);

    const marker = drive.files.find((f) => f.name === MOVED_MARKER_NAME && f.space === 'appdata');
    expect(marker).toBeDefined();
    expect(JSON.parse(new TextDecoder().decode(marker!.bytes)).folderName).toBe(KEEPER_FOLDER_NAME);
  });

  it('não deixa marcador se o cofre não chegou lá', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    drive.unreadable.add(VAULT_FILE_NAME);

    const report = await migrateToFolder(drive);

    expect(report.vaultFileId).toBeNull();
    expect(drive.files.some((f) => f.name === MOVED_MARKER_NAME)).toBe(false);
  });
});

describe('apagar a cópia antiga', () => {
  it('só apaga depois de conferir que tudo está na pasta nova', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    drive.seed('attachment-a1.bin', bytes('pdf'));
    const report = await migrateToFolder(drive);

    const result = await discardAppDataCopy(drive, report.folderId);

    expect(result.missing).toEqual([]);
    expect(result.deleted).toBe(2);
    // O marcador fica: é ele que diz aos outros aparelhos para onde o cofre foi.
    expect(drive.files.filter((f) => f.space === 'appdata').map((f) => f.name)).toEqual([MOVED_MARKER_NAME]);
    expect(drive.inFolder(report.folderId)).toHaveLength(2);
  });

  it('recusa apagar quando falta alguma coisa na pasta nova', async () => {
    const drive = new FakeDrive();
    drive.seed(VAULT_FILE_NAME, bytes('{"cofre":1}'));
    drive.seed('attachment-a1.bin', bytes('pdf'));
    drive.seed('attachment-a2.bin', bytes('outro'));
    drive.unreadable.add('attachment-a2.bin');
    const report = await migrateToFolder(drive);

    const result = await discardAppDataCopy(drive, report.folderId);

    expect(result.missing).toEqual(['attachment-a2.bin']);
    expect(result.deleted).toBe(0);
    expect(drive.files.filter((f) => f.space === 'appdata')).toHaveLength(4);
  });
});
