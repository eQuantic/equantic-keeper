import { describe, expect, it } from 'vitest';
import { ZipError, crc32, unzip, zip } from './zip';

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe('crc32', () => {
  /** Vetor conhecido: CRC-32 de "123456789" é 0xCBF43926. */
  it('bate com o vetor de referência', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });

  it('dá zero para entrada vazia', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('zip / unzip', () => {
  it('devolve os mesmos bytes na volta', () => {
    const entries = [
      { name: 'vault.keeper.json', bytes: text('{"format":"equantic-keeper.vault"}') },
      { name: 'attachments/abc.bin', bytes: bytes(0, 1, 2, 253, 254, 255) },
    ];
    expect(unzip(zip(entries))).toEqual(entries);
  });

  it('guarda nomes com acento e barra', () => {
    const entries = [{ name: 'anexos/título de residência.bin', bytes: text('x') }];
    expect(unzip(zip(entries))[0]?.name).toBe('anexos/título de residência.bin');
  });

  it('aceita arquivo vazio e entrada vazia', () => {
    expect(unzip(zip([]))).toEqual([]);
    expect(unzip(zip([{ name: 'vazio.bin', bytes: new Uint8Array() }]))).toEqual([
      { name: 'vazio.bin', bytes: new Uint8Array() },
    ]);
  });

  it('preserva a ordem das entradas', () => {
    const names = ['c.bin', 'a.bin', 'b.bin'];
    const archive = zip(names.map((name) => ({ name, bytes: text(name) })));
    expect(unzip(archive).map((entry) => entry.name)).toEqual(names);
  });

  it('aguenta conteúdo grande sem se perder nos offsets', () => {
    const big = new Uint8Array(300_000).map((_, index) => index % 251);
    const archive = zip([{ name: 'a.bin', bytes: text('primeiro') }, { name: 'grande.bin', bytes: big }]);
    const back = unzip(archive);
    expect(back[1]?.bytes).toEqual(big);
  });

  /**
   * Um backup é lido uma vez só, anos depois. Devolver um scan corrompido em
   * silêncio seria pior do que recusar o arquivo.
   */
  it('recusa entrada com CRC adulterado', () => {
    const archive = zip([{ name: 'a.bin', bytes: text('conteúdo original') }]);
    const corrupted = archive.slice();
    // Vira um byte no meio do conteúdo, sem tocar nos cabeçalhos.
    corrupted[40] = corrupted[40]! ^ 0xff;
    expect(() => unzip(corrupted)).toThrow(ZipError);
  });

  it('recusa arquivo que não é um ZIP', () => {
    expect(() => unzip(text('isto não é um zip'))).toThrow(/diretório central/i);
  });
});

describe('compatibilidade do formato', () => {
  const archive = zip([{ name: 'a.bin', bytes: text('oi') }]);
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

  it('começa com a assinatura que todo descompactador procura', () => {
    expect(view.getUint32(0, true)).toBe(0x04034b50);
  });

  /**
   * O leitor daqui anda pela contagem de entradas e nunca usa este campo, então
   * um erro nele passaria despercebido no ida-e-volta — foi o `unzip` do sistema
   * que recusou o arquivo. O teste existe para que isso não volte em silêncio.
   */
  it('declara o tamanho real do diretório central', () => {
    const end = archive.length - 22;
    const size = view.getUint32(end + 12, true);
    const start = view.getUint32(end + 16, true);
    expect(start + size).toBe(end);
  });

  it('marca os nomes como UTF-8 e o método como armazenado', () => {
    expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
    expect(view.getUint16(8, true)).toBe(0);
  });
});
