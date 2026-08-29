/**
 * Biometric unlock: the vault's master bits, wrapped behind a platform passkey.
 *
 * Typing a long master passphrase on a phone keyboard several times a day is
 * exactly what pushes people toward short passwords, so the phone's own
 * unlock — Face ID, fingerprint, device PIN — can stand in for it:
 *
 *   enrollment:  masterBits ── AES-GCM ──► localStorage record
 *                       key = HKDF(PRF(passkey, input), hkdfSalt, "…:prf-wrap:v1")
 *   unlock:      PRF(passkey, input) ──► same key ──► masterBits ──► HKDF ──► vault
 *
 * The PRF output only exists after the authenticator verifies the user, so the
 * wrapped record in localStorage is useless on its own: opening it requires
 * both this device's storage *and* passing the platform authenticator. The
 * master password remains the canonical key — this record can always be
 * deleted, ignored, or invalidated by a password change (the KDF salt it
 * pins no longer matches the vault's).
 *
 * WebAuthn itself (credential creation and the PRF evaluation) lives behind
 * `PrfPort` so everything above it stays testable without a browser.
 */
import {
  DecryptionError,
  fromBase64,
  randomBytes,
  toBase64,
  utf8,
  type KdfParams,
} from './crypto';

const WRAP_INFO = 'equantic-keeper:prf-wrap:v1';
const AAD_PREFIX = 'equantic-keeper:biometric:v1';
const PRF_INPUT_BYTES = 32;
const HKDF_SALT_BYTES = 16;
const IV_BYTES = 12;

export interface BiometricRecord {
  version: 1;
  /** base64: WebAuthn credential id of the platform passkey. */
  credentialId: string;
  /** base64: the fixed input fed to the passkey's PRF. */
  prfInput: string;
  /** base64: salt for deriving the wrapping key from the PRF output. */
  hkdfSalt: string;
  /** base64 */
  iv: string;
  /** base64: AES-GCM(masterBits). */
  wrapped: string;
  /** The vault's KDF at enrollment. A different salt means a changed password. */
  kdf: KdfParams;
}

/** Binds the ciphertext to the passkey and to the vault generation it opens. */
function aad(credentialId: string, kdf: KdfParams): string {
  return `${AAD_PREFIX}|${credentialId}|${kdf.salt}`;
}

async function wrappingKey(prfOutput: Uint8Array, hkdfSalt: Uint8Array): Promise<CryptoKey> {
  const s = crypto.subtle;
  const hkdf = await s.importKey('raw', prfOutput as Uint8Array<ArrayBuffer>, 'HKDF', false, [
    'deriveKey',
  ]);
  return s.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: hkdfSalt as Uint8Array<ArrayBuffer>,
      info: utf8(WRAP_INFO),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function wrapMasterBits(
  prfOutput: Uint8Array,
  masterBits: Uint8Array,
  credentialId: string,
  prfInput: Uint8Array,
  kdf: KdfParams,
): Promise<BiometricRecord> {
  const hkdfSalt = randomBytes(HKDF_SALT_BYTES);
  const key = await wrappingKey(prfOutput, hkdfSalt);
  const iv = randomBytes(IV_BYTES);
  const wrapped = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad(credentialId, kdf)), tagLength: 128 },
    key,
    masterBits as Uint8Array<ArrayBuffer>,
  );
  return {
    version: 1,
    credentialId,
    prfInput: toBase64(prfInput),
    hkdfSalt: toBase64(hkdfSalt),
    iv: toBase64(iv),
    wrapped: toBase64(new Uint8Array(wrapped)),
    kdf,
  };
}

export async function unwrapMasterBits(
  prfOutput: Uint8Array,
  record: BiometricRecord,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await wrappingKey(prfOutput, fromBase64(record.hkdfSalt));
  try {
    const bits = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(record.iv),
        additionalData: utf8(aad(record.credentialId, record.kdf)),
        tagLength: 128,
      },
      key,
      fromBase64(record.wrapped),
    );
    return new Uint8Array(bits);
  } catch {
    throw new DecryptionError('Não foi possível abrir o cofre com esta biometria.');
  }
}

/** Does this record open the vault generation described by `kdf`? */
export function matchesVault(record: BiometricRecord, kdf: KdfParams): boolean {
  return record.kdf.salt === kdf.salt && record.kdf.iterations === kdf.iterations;
}

export function isBiometricRecord(value: unknown): value is BiometricRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BiometricRecord>;
  return (
    v.version === 1 &&
    typeof v.credentialId === 'string' &&
    typeof v.prfInput === 'string' &&
    typeof v.hkdfSalt === 'string' &&
    typeof v.iv === 'string' &&
    typeof v.wrapped === 'string' &&
    !!v.kdf &&
    typeof v.kdf.salt === 'string'
  );
}

/* ------------------------------------------------------------------------- *
 * WebAuthn adapter
 * ------------------------------------------------------------------------- */

/** The PRF extension is not in every TS lib yet; typed here, never `any`. */
interface PrfInputs {
  prf?: { eval?: { first: BufferSource } } | Record<string, never>;
}
interface PrfOutputs {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

export interface PrfPort {
  /** Creates a platform passkey and confirms the authenticator supports PRF. */
  create(userLabel: string): Promise<{ credentialId: string }>;
  /** Evaluates the passkey's PRF over `input`, gated by user verification. */
  evalPrf(credentialId: string, input: Uint8Array): Promise<Uint8Array>;
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return (
      typeof PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

export function newPrfInput(): Uint8Array<ArrayBuffer> {
  return randomBytes(PRF_INPUT_BYTES);
}

export const webAuthnPrf: PrfPort = {
  async create(userLabel: string) {
    const extensions: AuthenticationExtensionsClientInputs & PrfInputs = { prf: {} };
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'eQuantic Keeper' },
        user: {
          id: randomBytes(16),
          name: userLabel,
          displayName: userLabel,
        },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        extensions,
      },
    })) as PublicKeyCredential | null;
    if (!credential) throw new Error('O navegador não criou a credencial.');

    const results = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs &
      PrfOutputs;
    if (!results.prf?.enabled) {
      throw new Error(
        'Este dispositivo criou a chave, mas não suporta a extensão PRF do WebAuthn — o desbloqueio por biometria não funciona nele.',
      );
    }
    return { credentialId: toBase64(new Uint8Array(credential.rawId)) };
  },

  async evalPrf(credentialId: string, input: Uint8Array) {
    const extensions: AuthenticationExtensionsClientInputs & PrfInputs = {
      prf: { eval: { first: input as Uint8Array<ArrayBuffer> } },
    };
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{ type: 'public-key', id: fromBase64(credentialId) }],
        userVerification: 'required',
        extensions,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) throw new Error('A verificação biométrica foi cancelada.');

    const results = assertion.getClientExtensionResults() as AuthenticationExtensionsClientOutputs &
      PrfOutputs;
    const first = results.prf?.results?.first;
    if (!first) {
      throw new Error('O autenticador não devolveu a saída PRF necessária para decifrar o cofre.');
    }
    return new Uint8Array(first);
  },
};
