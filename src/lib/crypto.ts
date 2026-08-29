/**
 * Zero-knowledge crypto core.
 *
 * Everything here runs in the browser with the Web Crypto API only — no keys,
 * no plaintext and no password derivative ever leaves the device. Google Drive
 * only ever receives the AES-GCM ciphertext produced by `seal()`.
 *
 * Key schedule:
 *   masterBits = PBKDF2-SHA256(password, salt, iterations) -> 256 bits
 *   encKey     = HKDF-SHA256(masterBits, salt, "…:enc:v1")     -> AES-GCM-256
 *   verifier   = HKDF-SHA256(masterBits, salt, "…:verify:v1")  -> 128 bits
 *
 * The verifier is stored in the (public) vault header so we can tell "wrong
 * master password" apart from "corrupted/tampered payload", and so we can
 * detect that a remote vault was re-encrypted with a different password before
 * attempting a merge. It is an independent HKDF output, so it reveals nothing
 * about `encKey` beyond what the ciphertext already exposes to an offline
 * attacker.
 */

export const KDF_ALGO = 'PBKDF2-SHA256' as const;
export const CIPHER = 'AES-GCM-256' as const;

/** OWASP 2023+ floor for PBKDF2-SHA256; ~0.5s on a modern laptop. */
export const DEFAULT_ITERATIONS = 720_000;
export const MIN_ITERATIONS = 210_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const VERIFIER_BYTES = 16;

const ENC_INFO = 'equantic-keeper:enc:v1';
const VERIFY_INFO = 'equantic-keeper:verify:v1';

export interface KdfParams {
  algo: typeof KDF_ALGO;
  iterations: number;
  /** base64 */
  salt: string;
}

export interface DerivedKey {
  key: CryptoKey;
  /** base64, safe to store in the clear */
  verifier: string;
  kdf: KdfParams;
}

const subtle = (): SubtleCrypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error(
      'Web Crypto indisponível. Use HTTPS (ou localhost) em um navegador moderno.',
    );
  }
  return c.subtle;
};

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  // TextEncoder is typed as ArrayBufferLike-backed; Web Crypto wants ArrayBuffer.
  return encoder.encode(value) as Uint8Array<ArrayBuffer>;
}

/** Constant-time comparison for short base64 tags. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function newKdfParams(iterations = DEFAULT_ITERATIONS): KdfParams {
  return {
    algo: KDF_ALGO,
    iterations: Math.max(MIN_ITERATIONS, Math.floor(iterations)),
    salt: toBase64(randomBytes(SALT_BYTES)),
  };
}

function validateKdf(kdf: KdfParams): Uint8Array<ArrayBuffer> {
  if (kdf.algo !== KDF_ALGO) {
    throw new Error(`Algoritmo de derivação não suportado: ${kdf.algo}`);
  }
  if (!Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS) {
    throw new Error('Parâmetros de derivação inválidos (iterações abaixo do mínimo seguro).');
  }
  const salt = fromBase64(kdf.salt);
  if (salt.length < 8) throw new Error('Parâmetros de derivação inválidos (salt curto).');
  return salt;
}

/**
 * The expensive PBKDF2 half of the schedule. Exposed on its own so the master
 * bits can be wrapped for biometric unlock; every other caller should go
 * through `deriveKey`, which never lets them out of this module.
 */
export async function deriveMasterBits(
  password: string,
  kdf: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = validateKdf(kdf);
  const s = subtle();
  const passwordKey = await s.importKey('raw', utf8(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const masterBits = await s.deriveBits(
    { name: 'PBKDF2', salt: salt, iterations: kdf.iterations, hash: 'SHA-256' },
    passwordKey,
    256,
  );
  return new Uint8Array(masterBits);
}

/** The cheap HKDF half: splits master bits into the encryption key and the verifier. */
export async function deriveKeyFromMasterBits(
  masterBits: Uint8Array,
  kdf: KdfParams,
): Promise<DerivedKey> {
  const salt = validateKdf(kdf);
  const s = subtle();
  const hkdfKey = await s.importKey('raw', masterBits as Uint8Array<ArrayBuffer>, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
  const key = await s.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: utf8(ENC_INFO) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the raw key can never be read back out of memory
    ['encrypt', 'decrypt'],
  );
  const verifierBits = await s.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt, info: utf8(VERIFY_INFO) },
    hkdfKey,
    VERIFIER_BYTES * 8,
  );

  return { key, verifier: toBase64(new Uint8Array(verifierBits)), kdf };
}

/**
 * Stretch the master password and split it into an encryption key and a
 * verifier. Rejects weakened parameters so a tampered header cannot trick the
 * client into a cheap derivation.
 */
export async function deriveKey(password: string, kdf: KdfParams): Promise<DerivedKey> {
  const masterBits = await deriveMasterBits(password, kdf);
  try {
    return await deriveKeyFromMasterBits(masterBits, kdf);
  } finally {
    masterBits.fill(0);
  }
}

export interface SealedBox {
  /** base64 */
  iv: string;
  /** base64 */
  data: string;
}

/**
 * Encrypt a JSON-serialisable value. `aad` binds the ciphertext to the public
 * header, so editing the header (e.g. swapping the salt or the KDF cost)
 * invalidates the authentication tag instead of silently changing behaviour.
 */
export async function seal(key: CryptoKey, value: unknown, aad: string): Promise<SealedBox> {
  const iv = randomBytes(IV_BYTES);
  const plaintext = utf8(JSON.stringify(value));
  const data = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv, additionalData: utf8(aad), tagLength: 128 },
    key,
    plaintext,
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
}

export class DecryptionError extends Error {
  constructor(message = 'Não foi possível decifrar: senha mestra incorreta ou dados corrompidos.') {
    super(message);
    this.name = 'DecryptionError';
  }
}

export async function open<T>(key: CryptoKey, box: SealedBox, aad: string): Promise<T> {
  let plaintext: ArrayBuffer;
  try {
    plaintext = await subtle().decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(box.iv),
        additionalData: utf8(aad),
        tagLength: 128,
      },
      key,
      fromBase64(box.data),
    );
  } catch {
    throw new DecryptionError();
  }
  try {
    return JSON.parse(decoder.decode(plaintext)) as T;
  } catch {
    throw new DecryptionError('Cofre decifrado, mas o conteúdo não é um JSON válido.');
  }
}

/** Non-secret, stable id used to name devices in the sync log. */
export function randomId(bytes = 12): string {
  return Array.from(randomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------------- *
 * Envelope encryption for attachments
 *
 * Each file gets its own random AES-GCM key, and only that key is encrypted
 * with the master key. Changing the master password then rewrites the vault
 * alone — a few kilobytes — instead of re-encrypting every PDF the user ever
 * uploaded. It also keeps a file's plaintext reachable from exactly one
 * wrapped key, so deleting the record makes the bytes in Drive unreadable.
 *
 * `wrapKey`/`unwrapKey` are deliberately not used: they would require adding
 * those usages to the derived master key, and exporting the content key and
 * encrypting the 32 raw bytes achieves the same with the usages we already
 * have.
 * ------------------------------------------------------------------------- */

export interface WrappedKey {
  /** base64: AES-GCM ciphertext of the raw content key */
  key: string;
  /** base64 */
  iv: string;
}

export async function generateContentKey(): Promise<CryptoKey> {
  // Extractable so it can be wrapped once; it never leaves this module unwrapped.
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapContentKey(
  master: CryptoKey,
  contentKey: CryptoKey,
  aad: string,
): Promise<WrappedKey> {
  const raw = await subtle().exportKey('raw', contentKey);
  const iv = randomBytes(IV_BYTES);
  const wrapped = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad), tagLength: 128 },
    master,
    raw,
  );
  return { key: toBase64(new Uint8Array(wrapped)), iv: toBase64(iv) };
}

export async function unwrapContentKey(
  master: CryptoKey,
  wrapped: WrappedKey,
  aad: string,
): Promise<CryptoKey> {
  let raw: ArrayBuffer;
  try {
    raw = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(wrapped.iv), additionalData: utf8(aad), tagLength: 128 },
      master,
      fromBase64(wrapped.key),
    );
  } catch {
    throw new DecryptionError('Não foi possível abrir a chave deste anexo.');
  }
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Encrypts raw bytes. Unlike `seal`, the output stays binary — base64 would
 * inflate every attachment by a third for no benefit. */
export async function sealBytes(
  key: CryptoKey,
  bytes: Uint8Array,
  aad: string,
): Promise<{ iv: string; data: Uint8Array<ArrayBuffer> }> {
  const iv = randomBytes(IV_BYTES);
  const data = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad), tagLength: 128 },
    key,
    bytes as Uint8Array<ArrayBuffer>,
  );
  return { iv: toBase64(iv), data: new Uint8Array(data) };
}

export async function openBytes(
  key: CryptoKey,
  iv: string,
  data: Uint8Array,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv), additionalData: utf8(aad), tagLength: 128 },
      key,
      data as Uint8Array<ArrayBuffer>,
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new DecryptionError('Anexo corrompido ou fora do cofre a que pertence.');
  }
}
