/**
 * Giving someone else a key to the vault, without giving them the password.
 *
 * The vault is encrypted with a data key that the header carries wrapped by the
 * password (see `vault.ts`). Sharing is therefore not a matter of re-encrypting
 * anything: it is wrapping those same 32 bytes a second time, for someone else.
 *
 * The recipient generates an ECDH keypair on their own device and hands out the
 * PUBLIC half as an invite code. Nothing secret travels, so the code can go by
 * WhatsApp, e-mail or read out loud — an attacker who intercepts it learns only
 * that someone was invited. The owner wraps the data key to that public key
 * (ECDH to a fresh ephemeral key, HKDF, AES-GCM) and publishes the result as a
 * share record beside the vault. Only the private key that never left the
 * recipient's device opens it.
 *
 * What this does NOT do is control what the recipient can do — that is Drive's
 * job, through the permission on the folder. A key opens; a permission decides
 * whether the Drive accepts a write.
 */
import { DecryptionError, fromBase64, randomBytes, toBase64, utf8 } from './crypto';

const CURVE = 'P-256';
const CODE_PREFIX = 'KEEPER1';
/** Enough to catch a mistyped or truncated code, not a security boundary. */
const CHECKSUM_CHARS = 6;

export class InviteCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InviteCodeError';
  }
}

/**
 * The recipient's keypair. The private half is generated non-extractable, so
 * the invite is bound to the device that created it: there is no way to copy it
 * to a second phone, and no way for the app to leak it if it wanted to.
 */
export interface Identity {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export interface ShareRecord {
  id: string;
  /** Who this was wrapped for — how a recipient finds their own record. */
  fingerprint: string;
  /** The one-off public key this wrap was made with (base64 raw point). */
  ephemeral: string;
  salt: string;
  iv: string;
  /** The vault's data key, encrypted to the recipient. */
  key: string;
  /**
   * What the owner intends. Enforcement lives in the Drive permission, not
   * here — this is what the owner's list shows and what revoking looks at.
   */
  role: 'reader' | 'writer';
  /** Free text the owner recognises: "Maria (telemóvel)". */
  label: string;
  /** The Google account the folder was shared with, when there is one. */
  email?: string;
  createdAt: string;
}

function subtle(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador não expõe Web Crypto (a página precisa estar em HTTPS).');
  }
  return globalThis.crypto.subtle;
}

export async function createIdentity(): Promise<Identity> {
  // `false` applies to the private key; the public half is always exportable,
  // which is exactly what the invite code needs.
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: CURVE }, false, ['deriveBits']);
  return { publicKey: pair.publicKey, privateKey: pair.privateKey };
}

async function rawPublicKey(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await subtle().exportKey('raw', key));
}

async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', raw.slice().buffer as ArrayBuffer, { name: 'ECDH', namedCurve: CURVE }, true, []);
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytes.slice().buffer as ArrayBuffer));
  return toBase64(digest).replace(/[^A-Za-z0-9]/g, '').slice(0, CHECKSUM_CHARS).toUpperCase();
}

/**
 * A stable short name for a public key. Two uses: the recipient finds their own
 * record with it, and the owner can read it aloud to confirm the code arrived
 * intact — the same eight characters on both screens or it is not the same key.
 */
export async function fingerprint(publicKey: CryptoKey): Promise<string> {
  const digest = new Uint8Array(await subtle().digest('SHA-256', await subtle().exportKey('raw', publicKey)));
  return toBase64(digest).replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
}

/** The text the recipient sends to the owner. Public data, safe in any channel. */
export async function inviteCode(identity: Pick<Identity, 'publicKey'>): Promise<string> {
  const raw = await rawPublicKey(identity.publicKey);
  return `${CODE_PREFIX}-${toBase64(raw)}-${await checksum(raw)}`;
}

/**
 * Reads a code back, tolerating what chat apps do to it: wrapped lines, stray
 * spaces, a lowercased prefix. A wrong checksum is reported as a typo rather
 * than as a cryptographic failure, because that is what it almost always is.
 */
export async function readInviteCode(code: string): Promise<CryptoKey> {
  const cleaned = code.replace(/\s+/g, '');
  const parts = cleaned.split('-');
  if (parts.length !== 3 || parts[0]!.toUpperCase() !== CODE_PREFIX) {
    throw new InviteCodeError('Isso não parece um código de convite do Keeper.');
  }
  const [, body, given] = parts as [string, string, string];

  let raw: Uint8Array;
  try {
    raw = fromBase64(body);
  } catch {
    throw new InviteCodeError('O código veio incompleto ou com caracteres a mais.');
  }
  if ((await checksum(raw)) !== given.toUpperCase()) {
    throw new InviteCodeError('O código não confere — provavelmente faltou um pedaço ao copiar.');
  }
  try {
    return await importPublicKey(raw);
  } catch {
    throw new InviteCodeError('O código não corresponde a uma chave válida.');
  }
}

/** Binds a wrap to the record it lives in: a record cannot be moved to another. */
function shareAad(id: string, fingerprintValue: string): string {
  return `equantic-keeper:share:v1|${id}|${fingerprintValue}`;
}

async function sharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  salt: Uint8Array,
  aad: string,
): Promise<CryptoKey> {
  const bits = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: salt.slice().buffer as ArrayBuffer, info: utf8(aad) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Wraps the vault's data key for one recipient.
 *
 * A fresh ephemeral keypair per record: the same data key shared with five
 * people produces five unrelated ciphertexts, and the owner's own keys are
 * never involved — there is nothing here for the owner to keep or lose.
 */
export async function wrapForRecipient(
  dataKey: CryptoKey,
  recipient: CryptoKey,
  details: { label: string; role: ShareRecord['role']; email?: string },
): Promise<ShareRecord> {
  const id = crypto.randomUUID();
  const print = await fingerprint(recipient);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const aad = shareAad(id, print);

  const ephemeral = await subtle().generateKey({ name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits']);
  const wrapping = await sharedKey(ephemeral.privateKey, recipient, salt, aad);
  const raw = await subtle().exportKey('raw', dataKey);
  const sealed = await subtle().encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad), tagLength: 128 },
    wrapping,
    raw,
  );

  return {
    id,
    fingerprint: print,
    ephemeral: toBase64(await rawPublicKey(ephemeral.publicKey)),
    salt: toBase64(salt),
    iv: toBase64(iv),
    key: toBase64(new Uint8Array(sealed)),
    role: details.role,
    label: details.label,
    ...(details.email ? { email: details.email } : {}),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Opens a record with the private key that never left this device.
 *
 * The data key comes back NON-extractable: a recipient never needs its bytes.
 * Saving an edit re-seals the payload under the header the owner wrote, and
 * re-sharing it with a third person is not theirs to do.
 */
export async function unwrapWithIdentity(record: ShareRecord, identity: Identity): Promise<CryptoKey> {
  try {
    const aad = shareAad(record.id, record.fingerprint);
    const ephemeral = await importPublicKey(fromBase64(record.ephemeral));
    const wrapping = await sharedKey(identity.privateKey, ephemeral, fromBase64(record.salt), aad);
    const raw = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(record.iv), additionalData: utf8(aad), tagLength: 128 },
      wrapping,
      fromBase64(record.key).slice().buffer as ArrayBuffer,
    );
    return await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } catch (error) {
    if (error instanceof InviteCodeError) throw error;
    throw new DecryptionError('Este convite não é para esta chave, ou foi revogado.');
  }
}

/** The file that carries the share records, beside the vault in the folder. */
export const SHARES_FILE_NAME = 'shares.keeper.json';

export interface SharesFile {
  format: 'equantic-keeper.shares';
  version: 1;
  shares: ShareRecord[];
  updatedAt: string;
}

export function emptyShares(): SharesFile {
  return {
    format: 'equantic-keeper.shares',
    version: 1,
    shares: [],
    updatedAt: new Date().toISOString(),
  };
}

export function isSharesFile(value: unknown): value is SharesFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<SharesFile>;
  return file.format === 'equantic-keeper.shares' && Array.isArray(file.shares);
}

/** The record meant for this identity, if the owner has published one. */
export async function findOwnShare(file: SharesFile, identity: Pick<Identity, 'publicKey'>): Promise<ShareRecord | null> {
  const print = await fingerprint(identity.publicKey);
  return file.shares.find((record) => record.fingerprint === print) ?? null;
}
