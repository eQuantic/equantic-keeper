import { describe, expect, it } from 'vitest';
import { MIN_ITERATIONS } from './crypto';
import { exportBundle, parseBundle, referencedAttachments } from './backup';
import { createItem, type AttachmentRef, type VaultItem } from './model';
import { createVault, emptyPayload, unlockVault, type VaultPayload } from './vault';
import { zip } from './zip';

const iterations = MIN_ITERATIONS;
const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

function attachment(id: string, name = `${id}.pdf`): AttachmentRef {
  return {
    id,
    name,
    mimeType: 'application/pdf',
    size: 3,
    wrapped: { key: 'a2V5', iv: 'aXY=' },
    iv: 'aXY=',
    driveFileId: `drive-${id}`,
    addedAt: '2026-08-01T00:00:00.000Z',
  };
}

function item(id: string, attachments: AttachmentRef[], extra: Partial<VaultItem> = {}): VaultItem {
  return { ...createItem('pt-residencia'), id, name: `item-${id}`, attachments, ...extra };
}

function payloadWith(...items: VaultItem[]): VaultPayload {
  return { ...emptyPayload(), items };
}

/**
 * `exportBundle` downloads, which needs a DOM. The archive it builds is the
 * part worth testing, so the bytes are intercepted at the Blob boundary.
 */
async function captureBundle(payload: VaultPayload, files: Map<string, Uint8Array>): Promise<Uint8Array> {
  const { file } = await createVault('senha-mestra-de-teste', payload, iterations);
  let captured: Uint8Array | null = null;

  const globals = globalThis as Record<string, unknown>;
  const original = {
    URL: globals.URL,
    document: globals.document,
  };
  globals.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => undefined };
  globals.document = {
    createElement: () => ({ click: () => undefined, remove: () => undefined, style: {} }),
    body: { append: () => undefined },
  };
  const RealBlob = globalThis.Blob;
  globals.Blob = class extends RealBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      const first = parts[0];
      if (first instanceof Uint8Array) captured = first;
    }
  };

  try {
    exportBundle(file, files);
  } finally {
    globals.Blob = RealBlob;
    globals.URL = original.URL;
    globals.document = original.document;
  }

  if (!captured) throw new Error('o pacote não chegou a ser montado');
  return captured;
}

describe('referencedAttachments', () => {
  it('junta os anexos de todos os itens, inclusive os da lixeira', () => {
    const payload = payloadWith(
      item('a', [attachment('a1'), attachment('a2')]),
      item('b', [attachment('b1')], { deletedAt: '2026-08-01T00:00:00.000Z' }),
    );
    // Item na lixeira ainda pode ser restaurado: o anexo dele não é órfão.
    expect(referencedAttachments(payload).map((ref) => ref.id)).toEqual(['a1', 'a2', 'b1']);
  });
});

describe('pacote de backup', () => {
  it('leva o cofre e os anexos, e devolve os dois na volta', async () => {
    const payload = payloadWith(item('doc', [attachment('a1', 'residencia.pdf')]));
    const files = new Map([['a1', bytes(9, 8, 7)]]);

    const bundle = parseBundle(await captureBundle(payload, files));

    expect(bundle.attachments.get('a1')).toEqual(bytes(9, 8, 7));
    const opened = await unlockVault(bundle.file, 'senha-mestra-de-teste');
    expect(opened.payload.items[0]?.attachments[0]?.name).toBe('residencia.pdf');
  });

  it('não deixa nada legível no pacote', async () => {
    const payload = payloadWith(item('doc', [attachment('a1', 'residencia.pdf')]));
    const raw = new TextDecoder().decode(await captureBundle(payload, new Map([['a1', bytes(1, 2)]])));

    expect(raw).not.toContain('residencia.pdf');
    expect(raw).not.toContain('item-doc');
    expect(raw).toContain('equantic-keeper.vault'); // o cabeçalho público, esse sim
  });

  it('exige a senha mestra do backup para abrir', async () => {
    const bundle = parseBundle(await captureBundle(payloadWith(item('doc', [])), new Map()));
    await expect(unlockVault(bundle.file, 'senha-errada')).rejects.toThrow();
  });

  it('funciona com um cofre sem nenhum anexo', async () => {
    const bundle = parseBundle(await captureBundle(payloadWith(item('doc', [])), new Map()));
    expect(bundle.attachments.size).toBe(0);
  });

  it('recusa um ZIP que não tem o cofre dentro', () => {
    const semCofre = zip([{ name: 'attachments/attachment-a1.bin', bytes: bytes(1) }]);
    expect(() => parseBundle(semCofre)).toThrow(/não contém vault\.keeper\.json/i);
  });

  /** Alguém abre o backup, olha o conteúdo e recompacta: ainda tem que restaurar. */
  it('ignora arquivo estranho no pacote em vez de falhar', async () => {
    const original = parseBundle(await captureBundle(payloadWith(item('doc', [])), new Map()));
    const remexido = zip([
      { name: 'leia-me.txt', bytes: text('anotações minhas') },
      { name: 'vault.keeper.json', bytes: text(JSON.stringify(original.file)) },
    ]);
    expect(parseBundle(remexido).file.format).toBe('equantic-keeper.vault');
  });
});
