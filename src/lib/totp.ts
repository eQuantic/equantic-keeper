/**
 * RFC 4648 base32 + RFC 6238 TOTP, implemented on Web Crypto so no third-party
 * code ever touches a 2FA seed.
 */

export type TotpAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-512';

export interface TotpConfig {
  secret: string;
  digits: number;
  period: number;
  algorithm: TotpAlgorithm;
  label?: string;
  issuer?: string;
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (!clean) return new Uint8Array(0);
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Caractere base32 inválido: "${char}"`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

const ALGORITHM_ALIASES: Record<string, TotpAlgorithm> = {
  SHA1: 'SHA-1',
  'SHA-1': 'SHA-1',
  SHA256: 'SHA-256',
  'SHA-256': 'SHA-256',
  SHA512: 'SHA-512',
  'SHA-512': 'SHA-512',
};

/** Accepts a raw base32 seed or a full `otpauth://totp/...` URI. */
export function parseTotp(input: string): TotpConfig {
  const value = input.trim();
  if (!value) throw new Error('Segredo TOTP vazio.');

  if (/^otpauth:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.host.toLowerCase() !== 'totp') throw new Error('Apenas URIs otpauth do tipo TOTP são suportadas.');
    const secret = url.searchParams.get('secret');
    if (!secret) throw new Error('URI otpauth sem parâmetro "secret".');
    const path = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const [maybeIssuer, maybeLabel] = path.includes(':') ? path.split(':') : [undefined, path];
    return {
      secret,
      digits: clampInt(url.searchParams.get('digits'), 6, 6, 10),
      period: clampInt(url.searchParams.get('period'), 30, 5, 300),
      algorithm: ALGORITHM_ALIASES[(url.searchParams.get('algorithm') ?? 'SHA1').toUpperCase()] ?? 'SHA-1',
      issuer: url.searchParams.get('issuer') ?? maybeIssuer?.trim(),
      label: maybeLabel?.trim(),
    };
  }

  return { secret: value, digits: 6, period: 30, algorithm: 'SHA-1' };
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export async function generateTotp(config: TotpConfig, atMs: number = Date.now()): Promise<string> {
  const key = base32Decode(config.secret);
  if (key.length === 0) throw new Error('Segredo TOTP inválido.');

  const counter = Math.floor(atMs / 1000 / config.period);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter), false);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: config.algorithm },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, message));

  // Dynamic truncation (RFC 4226 §5.4).
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);

  return (binary % 10 ** config.digits).toString().padStart(config.digits, '0');
}

/** Seconds until the current code rotates. */
export function secondsRemaining(period: number, atMs: number = Date.now()): number {
  return period - (Math.floor(atMs / 1000) % period);
}
