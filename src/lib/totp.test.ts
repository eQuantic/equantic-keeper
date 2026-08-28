import { describe, expect, it } from 'vitest';
import { base32Decode, generateTotp, parseTotp, secondsRemaining } from './totp';

/** RFC 6238 Appendix B uses the ASCII seed "12345678901234567890". */
const RFC_SEED_ASCII = '12345678901234567890';
const RFC_SEED_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('base32Decode', () => {
  it('decodes the RFC 6238 seed', () => {
    const decoded = new TextDecoder().decode(base32Decode(RFC_SEED_BASE32));
    expect(decoded).toBe(RFC_SEED_ASCII);
  });

  it('ignores padding, spaces and case', () => {
    expect([...base32Decode('mzxw 6yq=')]).toEqual([...base32Decode('MZXW6YQ')]);
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => base32Decode('MZXW6YQ!')).toThrow(/inválido/i);
  });
});

describe('generateTotp', () => {
  const config = { secret: RFC_SEED_BASE32, digits: 8, period: 30, algorithm: 'SHA-1' as const };

  // Test vectors from RFC 6238 Appendix B (SHA-1 column).
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('matches the RFC vector at T=%i', async (seconds, expected) => {
    await expect(generateTotp(config, seconds * 1000)).resolves.toBe(expected);
  });

  it('truncates to six digits when asked', async () => {
    await expect(generateTotp({ ...config, digits: 6 }, 59_000)).resolves.toBe('287082');
  });

  it('keeps the same code inside one period and rotates after it', async () => {
    const a = await generateTotp(config, 60_000);
    const b = await generateTotp(config, 89_000);
    const c = await generateTotp(config, 90_000);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });
});

describe('parseTotp', () => {
  it('accepts a bare base32 secret with sensible defaults', () => {
    expect(parseTotp(` ${RFC_SEED_BASE32} `)).toMatchObject({
      secret: RFC_SEED_BASE32,
      digits: 6,
      period: 30,
      algorithm: 'SHA-1',
    });
  });

  it('parses an otpauth URI including issuer and parameters', () => {
    const uri = `otpauth://totp/eQuantic:edgar%40equantic.tech?secret=${RFC_SEED_BASE32}&issuer=eQuantic&digits=8&period=60&algorithm=SHA256`;
    expect(parseTotp(uri)).toMatchObject({
      secret: RFC_SEED_BASE32,
      digits: 8,
      period: 60,
      algorithm: 'SHA-256',
      issuer: 'eQuantic',
    });
  });

  it('rejects hotp URIs and empty input', () => {
    expect(() => parseTotp(`otpauth://hotp/x?secret=${RFC_SEED_BASE32}`)).toThrow(/TOTP/i);
    expect(() => parseTotp('   ')).toThrow(/vazio/i);
  });
});

describe('secondsRemaining', () => {
  it('counts down within the period', () => {
    expect(secondsRemaining(30, 0)).toBe(30);
    expect(secondsRemaining(30, 25_000)).toBe(5);
    expect(secondsRemaining(30, 30_000)).toBe(30);
  });
});
