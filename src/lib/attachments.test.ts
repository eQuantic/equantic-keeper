import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The device cache is IndexedDB, which does not exist under `environment:
 * 'node'`. A map stands in for it so the "cache first, Drive second" rule can
 * be tested for what it is — a decision — instead of being skipped.
 */
const cache = new Map<string, Uint8Array>();
vi.mock('./blobstore', () => ({
  putCiphertext: async (id: string, bytes: Uint8Array) => void cache.set(id, bytes),
  getCiphertext: async (id: string) => cache.get(id) ?? null,
  removeCiphertext: async (id: string) => void cache.delete(id),
  clearCiphertext: async () => cache.clear(),
  cachedIds: async () => [...cache.keys()],
}));

const { DecryptionError, MIN_ITERATIONS, deriveKey, newKdfParams } = await import('./crypto');
const {
  AttachmentTooLargeError,
  AttachmentTypeError,
  MAX_ATTACHMENT_BYTES,
  decryptAttachment,
  encryptAttachment,
  fetchCiphertext,
  forgetAttachment,
  formatBytes,
  isAccepted,
  openAttachment,
  uploadAttachment,
} = await import('./attachments');
const { driveName, findOrphans, ORPHAN_GRACE_DAYS } = await import('./attachments');

import type { DriveBlobApi, DriveFileMeta } from './drive';
import type { AttachmentRef } from './model';

/** In-memory Drive: stores the exact bytes it is handed. */
class FakeDrive implements DriveBlobApi {
  readonly files = new Map<string, Uint8Array>();
  readonly calls = { create: 0, download: 0, delete: 0 };
  private next = 1;

  async createBlob(name: string, bytes: Uint8Array): Promise<DriveFileMeta> {
    this.calls.create += 1;
    const id = `drive-${this.next++}`;
    this.files.set(id, bytes);
    return { id, name, modifiedTime: new Date().toISOString() };
  }

  async downloadBlob(fileId: string): Promise<Uint8Array> {
    this.calls.download += 1;
    const bytes = this.files.get(fileId);
    if (!bytes) throw new Error(`arquivo inexistente: ${fileId}`);
    return bytes;
  }

  async delete(fileId: string): Promise<void> {
    this.calls.delete += 1;
    this.files.delete(fileId);
  }
}

const master = async (password = 'senha-mestra-de-teste') =>
  (await deriveKey(password, newKdfParams(MIN_ITERATIONS))).key;

/** A tiny but real PDF header, so nothing here depends on made-up bytes. */
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');

function pdf(name = 'titulo-residencia.pdf', bytes: Uint8Array = PDF_BYTES): File {
  return new File([bytes as BlobPart], name, { type: 'application/pdf' });
}

beforeEach(() => cache.clear());

describe('encryptAttachment', () => {
  it('devolve exatamente os bytes originais na volta', async () => {
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());

    expect(ref.name).toBe('titulo-residencia.pdf');
    expect(ref.mimeType).toBe('application/pdf');
    expect(ref.size).toBe(PDF_BYTES.length);
    expect(await decryptAttachment(key, ref, ciphertext)).toEqual(PDF_BYTES);
  });

  it('não deixa o conteúdo aparecer no ciphertext', async () => {
    const { ciphertext } = await encryptAttachment(await master(), pdf());
    expect(new TextDecoder().decode(ciphertext)).not.toContain('%PDF');
  });

  it('usa uma chave própria por arquivo', async () => {
    const key = await master();
    const a = await encryptAttachment(key, pdf());
    const b = await encryptAttachment(key, pdf());

    // Mesmo arquivo, mesma senha: nada em comum entre as duas cifragens.
    expect(a.ref.wrapped.key).not.toBe(b.ref.wrapped.key);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('recusa formato que o visualizador não abre', async () => {
    const key = await master();
    const exe = new File([new Uint8Array([1, 2, 3]) as BlobPart], 'setup.exe', { type: 'application/x-msdownload' });
    await expect(encryptAttachment(key, exe)).rejects.toBeInstanceOf(AttachmentTypeError);
  });

  it('deduz o tipo pela extensão quando o navegador não informa', async () => {
    const key = await master();
    const semTipo = new File([PDF_BYTES as BlobPart], 'certidao.pdf', { type: '' });
    const { ref } = await encryptAttachment(key, semTipo);
    expect(ref.mimeType).toBe('application/pdf');
  });

  it('recusa arquivo acima do limite', async () => {
    const key = await master();
    const grande = new File([new Uint8Array(16) as BlobPart], 'scan.pdf', { type: 'application/pdf' });
    Object.defineProperty(grande, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });
    await expect(encryptAttachment(key, grande)).rejects.toBeInstanceOf(AttachmentTooLargeError);
  });
});

describe('vínculos do anexo', () => {
  it('recusa a chave mestra errada', async () => {
    const { ref, ciphertext } = await encryptAttachment(await master('certa'), pdf());
    await expect(decryptAttachment(await master('errada'), ref, ciphertext)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  /** Sem isso, trocar dois arquivos de lugar no cofre passaria despercebido. */
  it('não decifra o ciphertext de outro anexo', async () => {
    const key = await master();
    const a = await encryptAttachment(key, pdf('a.pdf'));
    const b = await encryptAttachment(key, pdf('b.pdf'));

    await expect(decryptAttachment(key, a.ref, b.ciphertext)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('quebra se o tipo declarado no cofre for adulterado', async () => {
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());

    const disfarcado: AttachmentRef = { ...ref, mimeType: 'image/png' };
    await expect(decryptAttachment(key, disfarcado, ciphertext)).rejects.toBeInstanceOf(DecryptionError);
  });

  it('quebra se o tamanho declarado for adulterado', async () => {
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    await expect(decryptAttachment(key, { ...ref, size: ref.size + 1 }, ciphertext)).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('quebra se a chave envelopada for movida para outro registro', async () => {
    const key = await master();
    const a = await encryptAttachment(key, pdf('a.pdf'));
    const b = await encryptAttachment(key, pdf('b.pdf'));

    const trocado: AttachmentRef = { ...a.ref, wrapped: b.ref.wrapped };
    await expect(decryptAttachment(key, trocado, a.ciphertext)).rejects.toBeInstanceOf(DecryptionError);
  });
});

describe('envio e leitura', () => {
  it('envia o pendente e passa a apontar para o arquivo do Drive', async () => {
    const drive = new FakeDrive();
    const { ref, ciphertext } = await encryptAttachment(await master(), pdf());
    expect(ref.driveFileId).toBe('');

    const enviado = await uploadAttachment(drive, ref, ciphertext);

    expect(enviado.driveFileId).not.toBe('');
    expect(drive.files.get(enviado.driveFileId)).toEqual(ciphertext);
    expect(driveName(ref)).toContain(ref.id);
  });

  it('não reenvia o que já está no Drive', async () => {
    const drive = new FakeDrive();
    const { ref, ciphertext } = await encryptAttachment(await master(), pdf());
    const enviado = await uploadAttachment(drive, ref, ciphertext);

    expect(await uploadAttachment(drive, enviado)).toBe(enviado);
    expect(drive.calls.create).toBe(1);
  });

  it('envia a partir do cache quando o ciphertext não é passado', async () => {
    const drive = new FakeDrive();
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    cache.set(ref.id, ciphertext);

    const enviado = await uploadAttachment(drive, ref);
    expect(drive.files.get(enviado.driveFileId)).toEqual(ciphertext);
  });

  it('lê do dispositivo sem tocar na rede quando há cache', async () => {
    const drive = new FakeDrive();
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    const enviado = await uploadAttachment(drive, ref, ciphertext);
    cache.set(enviado.id, ciphertext);

    expect(await fetchCiphertext(drive, enviado)).toEqual(ciphertext);
    expect(drive.calls.download).toBe(0);
  });

  it('baixa do Drive e guarda no dispositivo para a próxima vez', async () => {
    const drive = new FakeDrive();
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    const enviado = await uploadAttachment(drive, ref, ciphertext);
    cache.clear();

    expect(await fetchCiphertext(drive, enviado)).toEqual(ciphertext);
    expect(drive.calls.download).toBe(1);

    await fetchCiphertext(drive, enviado);
    expect(drive.calls.download).toBe(1); // a segunda leitura veio do cache
  });

  it('explica o que houve quando o anexo não está em lugar nenhum', async () => {
    const { ref } = await encryptAttachment(await master(), pdf());
    await expect(fetchCiphertext(new FakeDrive(), ref)).rejects.toThrow(/ainda não foi enviado/i);
  });

  it('avisa quando falta conexão para buscar o que só está no Drive', async () => {
    const drive = new FakeDrive();
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    const enviado = await uploadAttachment(drive, ref, ciphertext);
    cache.clear();

    await expect(fetchCiphertext(null, enviado)).rejects.toThrow(/sem conexão/i);
  });

  it('entrega um Blob com o tipo certo para o visualizador', async () => {
    const drive = new FakeDrive();
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    const enviado = await uploadAttachment(drive, ref, ciphertext);

    const blob = await openAttachment(drive, key, enviado);
    expect(blob.type).toBe('application/pdf');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PDF_BYTES);
  });
});

describe('forgetAttachment', () => {
  it('apaga do dispositivo e do Drive', async () => {
    const drive = new FakeDrive();
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    const enviado = await uploadAttachment(drive, ref, ciphertext);
    cache.set(enviado.id, ciphertext);

    await forgetAttachment(drive, enviado);

    expect(cache.has(enviado.id)).toBe(false);
    expect(drive.files.has(enviado.driveFileId)).toBe(false);
  });

  /** Perder o anexo no Drive não pode travar a remoção: sem a chave envelopada
   * o ciphertext órfão é ilegível de qualquer forma. */
  it('remove a referência mesmo se o Drive recusar', async () => {
    const drive = new FakeDrive();
    drive.delete = async () => {
      throw new Error('Drive fora do ar');
    };
    const key = await master();
    const { ref, ciphertext } = await encryptAttachment(key, pdf());
    cache.set(ref.id, ciphertext);

    await expect(forgetAttachment(drive, { ...ref, driveFileId: 'drive-1' })).resolves.toBeUndefined();
    expect(cache.has(ref.id)).toBe(false);
  });
});

describe('ajudantes de exibição', () => {
  it('formata tamanhos de forma legível', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3_500_000)).toBe('3.3 MB');
  });

  it('aceita só o que o visualizador abre', () => {
    expect(isAccepted('application/pdf')).toBe(true);
    expect(isAccepted('image/png')).toBe(true);
    expect(isAccepted('text/html')).toBe(false);
  });
});

describe('findOrphans', () => {
  const NOW = Date.parse('2026-08-29T12:00:00Z');
  const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

  /** Só a fatia do Drive que a varredura usa. */
  const driveWith = (files: { id: string; name: string; modifiedTime: string }[]) => ({
    delete: async () => undefined,
    listFiles: async () => files,
  });

  const ref = (id: string): AttachmentRef => ({
    id,
    name: `${id}.pdf`,
    mimeType: 'application/pdf',
    size: 1,
    wrapped: { key: 'a2V5', iv: 'aXY=' },
    iv: 'aXY=',
    driveFileId: `drive-${id}`,
    addedAt: daysAgo(200),
  });

  it('não toca no que o cofre ainda referencia', async () => {
    const drive = driveWith([{ id: 'drive-a', name: driveName({ id: 'a' }), modifiedTime: daysAgo(500) }]);
    expect(await findOrphans(drive, [ref('a')], NOW)).toEqual([]);
  });

  it('encontra o que ninguém referencia e já passou da carência', async () => {
    const drive = driveWith([
      { id: 'drive-a', name: driveName({ id: 'a' }), modifiedTime: daysAgo(500) },
      { id: 'drive-x', name: driveName({ id: 'x' }), modifiedTime: daysAgo(ORPHAN_GRACE_DAYS + 1) },
    ]);
    expect(await findOrphans(drive, [ref('a')], NOW)).toEqual(['drive-x']);
  });

  /**
   * A regra que evita o pior caso: outro aparelho subiu o scan agora e a
   * mudança do cofre ainda não chegou aqui. Dentro da carência, não se apaga.
   */
  it('poupa arquivo recente mesmo sem referência', async () => {
    const drive = driveWith([
      { id: 'drive-novo', name: driveName({ id: 'novo' }), modifiedTime: daysAgo(1) },
      { id: 'drive-limite', name: driveName({ id: 'limite' }), modifiedTime: daysAgo(ORPHAN_GRACE_DAYS - 1) },
    ]);
    expect(await findOrphans(drive, [], NOW)).toEqual([]);
  });

  it('ignora o cofre e os backups, que não são anexos', async () => {
    const drive = driveWith([
      { id: 'vault', name: 'vault.keeper.json', modifiedTime: daysAgo(900) },
      { id: 'backup', name: 'backup-2026-01-01.json', modifiedTime: daysAgo(900) },
    ]);
    expect(await findOrphans(drive, [], NOW)).toEqual([]);
  });
});
