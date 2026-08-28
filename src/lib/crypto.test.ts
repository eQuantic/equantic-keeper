import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  MIN_ITERATIONS,
  deriveKey,
  fromBase64,
  newKdfParams,
  open,
  randomBytes,
  seal,
  timingSafeEqual,
  toBase64,
} from './crypto';

const kdf = () => newKdfParams(MIN_ITERATIONS);

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = randomBytes(256);
    expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes]);
  });

  it('handles empty input', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(fromBase64('').length).toBe(0);
  });
});

describe('timingSafeEqual', () => {
  it('compares by value, not by reference', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('deriveKey', () => {
  it('is deterministic for the same password and params', async () => {
    const params = kdf();
    const a = await deriveKey('correct horse battery staple', params);
    const b = await deriveKey('correct horse battery staple', params);
    expect(a.verifier).toBe(b.verifier);
  });

  it('produces a different verifier for a different password', async () => {
    const params = kdf();
    const a = await deriveKey('senha-a', params);
    const b = await deriveKey('senha-b', params);
    expect(a.verifier).not.toBe(b.verifier);
  });

  it('normalises unicode so equivalent passwords match', async () => {
    const params = kdf();
    // "á" as a single code point vs. "a" + combining acute.
    const a = await deriveKey('senção', params);
    const b = await deriveKey('senção', params);
    expect(a.verifier).toBe(b.verifier);
  });

  it('rejects weakened KDF parameters', async () => {
    await expect(deriveKey('x', { ...kdf(), iterations: 1000 })).rejects.toThrow(/iterações/i);
  });
});

describe('seal / open', () => {
  it('round-trips a JSON payload', async () => {
    const derived = await deriveKey('senha', kdf());
    const value = { items: [{ id: '1', token: 'ghp_secret' }], n: 42 };
    const box = await seal(derived.key, value, 'header');
    expect(box.data).not.toContain('ghp_secret');
    await expect(open(derived.key, box, 'header')).resolves.toEqual(value);
  });

  it('fails with the wrong key', async () => {
    const params = kdf();
    const good = await deriveKey('senha', params);
    const bad = await deriveKey('outra', params);
    const box = await seal(good.key, { a: 1 }, 'header');
    await expect(open(bad.key, box, 'header')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('fails when the associated header is tampered with', async () => {
    const derived = await deriveKey('senha', kdf());
    const box = await seal(derived.key, { a: 1 }, 'header-v1');
    await expect(open(derived.key, box, 'header-v2')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('fails when the ciphertext is modified', async () => {
    const derived = await deriveKey('senha', kdf());
    const box = await seal(derived.key, { a: 1 }, 'header');
    const bytes = fromBase64(box.data);
    bytes[0] ^= 0xff;
    await expect(open(derived.key, { ...box, data: toBase64(bytes) }, 'header')).rejects.toBeInstanceOf(
      DecryptionError,
    );
  });

  it('uses a fresh IV for every seal', async () => {
    const derived = await deriveKey('senha', kdf());
    const a = await seal(derived.key, { a: 1 }, 'header');
    const b = await seal(derived.key, { a: 1 }, 'header');
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });
});
