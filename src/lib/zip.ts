/**
 * Minimal ZIP reader and writer, stored (uncompressed) entries only.
 *
 * A backup that carries the attachments has to be one file the user can keep
 * anywhere, and ZIP is the one container every operating system opens without
 * being taught. Base64 inside a JSON would have been less code, but it inflates
 * every scan by a third and forces the whole archive through a single string —
 * which is exactly how a 200 MB export becomes an out-of-memory crash.
 *
 * Nothing is compressed on purpose: the entries are AES-GCM ciphertext, which
 * is incompressible by construction. Deflating it would burn CPU to save
 * nothing, and pull in a dependency for the privilege.
 */

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
/** `store`: no compression. The only method this reader and writer speak. */
const METHOD_STORE = 0;

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

class Writer {
  private parts: Uint8Array[] = [];
  length = 0;

  push(bytes: Uint8Array): void {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  u16(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff]));
  }

  u32(value: number): void {
    this.push(new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]));
  }

  concat(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function zip(entries: ZipEntry[]): Uint8Array<ArrayBuffer> {
  const out = new Writer();
  const directory: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.bytes);
    const offset = out.length;

    out.u32(LOCAL_HEADER);
    out.u16(20); // version needed
    out.u16(0x0800); // flags: names are UTF-8
    out.u16(METHOD_STORE);
    out.u16(0); // mod time — left at zero, the vault carries the real timestamps
    out.u16(0); // mod date
    out.u32(crc);
    out.u32(entry.bytes.length); // compressed size == uncompressed, stored
    out.u32(entry.bytes.length);
    out.u16(name.length);
    out.u16(0); // extra field length
    out.push(name);
    out.push(entry.bytes);

    directory.push({ name, crc, size: entry.bytes.length, offset });
  }

  const centralStart = out.length;
  for (const entry of directory) {
    out.u32(CENTRAL_HEADER);
    out.u16(20); // version made by
    out.u16(20); // version needed
    out.u16(0x0800);
    out.u16(METHOD_STORE);
    out.u16(0);
    out.u16(0);
    out.u32(entry.crc);
    out.u32(entry.size);
    out.u32(entry.size);
    out.u16(entry.name.length);
    out.u16(0); // extra
    out.u16(0); // comment
    out.u16(0); // disk number
    out.u16(0); // internal attributes
    out.u32(0); // external attributes
    out.u32(entry.offset);
    out.push(entry.name);
  }

  // Measured before the end record is written: its own bytes are not part of
  // the directory, and counting them makes real unzip implementations refuse
  // the archive ("central directory is 12 bytes too long").
  const centralSize = out.length - centralStart;

  out.u32(END_OF_CENTRAL);
  out.u16(0); // this disk
  out.u16(0); // disk with central directory
  out.u16(directory.length);
  out.u16(directory.length);
  out.u32(centralSize);
  out.u32(centralStart);
  out.u16(0); // comment length

  return out.concat();
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/**
 * Reads a stored ZIP by walking the central directory — the only index the
 * format guarantees to be authoritative. The CRC of every entry is verified:
 * a backup is read exactly once, years later, and silently returning a
 * corrupted scan would be worse than refusing to open it.
 */
export function unzip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let end = -1;
  // The end record is last, but a trailing comment may follow it.
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === END_OF_CENTRAL) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new ZipError('Arquivo ZIP inválido: diretório central não encontrado.');

  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER) {
      throw new ZipError('Arquivo ZIP inválido: entrada corrompida no diretório.');
    }
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (method !== METHOD_STORE) {
      throw new ZipError(`"${name}" está comprimido; este leitor só abre entradas armazenadas.`);
    }
    if (view.getUint32(localOffset, true) !== LOCAL_HEADER) {
      throw new ZipError(`Arquivo ZIP inválido: cabeçalho local de "${name}" corrompido.`);
    }

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const content = bytes.subarray(start, start + size);

    if (crc32(content) !== crc) throw new ZipError(`"${name}" está corrompido (CRC não confere).`);
    entries.push({ name, bytes: content });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
