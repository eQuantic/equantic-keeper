import { describe, expect, it } from 'vitest';
import {
  isBiometricRecord,
  matchesVault,
  newPrfInput,
  unwrapMasterBits,
  wrapMasterBits,
} from './biometric';
import {
  DecryptionError,
  deriveKey,
  deriveKeyFromMasterBits,
  deriveMasterBits,
  newKdfParams,
  randomBytes,
} from './crypto';

const kdf = newKdfParams(210_000);

describe('key schedule split', () => {
  it('deriveMasterBits + deriveKeyFromMasterBits equals deriveKey', async () => {
    const whole = await deriveKey('senha-mestra-de-teste', kdf);
    const bits = await deriveMasterBits('senha-mestra-de-teste', kdf);
    const split = await deriveKeyFromMasterBits(bits, kdf);
    // The verifier is an HKDF output of the same master bits: equal verifiers
    // mean equal key material end to end.
    expect(split.verifier).toBe(whole.verifier);
  });
});

describe('wrapMasterBits / unwrapMasterBits', () => {
  const prfOutput = randomBytes(32);
  const masterBits = randomBytes(32);
  const credentialId = 'Y3JlZC1pZC1kZS10ZXN0ZQ==';

  it('round-trips the master bits', async () => {
    const record = await wrapMasterBits(prfOutput, masterBits, credentialId, newPrfInput(), kdf);
    const opened = await unwrapMasterBits(prfOutput, record);
    expect(Array.from(opened)).toEqual(Array.from(masterBits));
  });

  it('the wrapped record never contains the master bits in the clear', async () => {
    const record = await wrapMasterBits(prfOutput, masterBits, credentialId, newPrfInput(), kdf);
    expect(JSON.stringify(record)).not.toContain(Buffer.from(masterBits).toString('base64'));
  });

  it('a different PRF output cannot open it', async () => {
    const record = await wrapMasterBits(prfOutput, masterBits, credentialId, newPrfInput(), kdf);
    await expect(unwrapMasterBits(randomBytes(32), record)).rejects.toThrow(DecryptionError);
  });

  it('moving the record to another credential breaks the AAD', async () => {
    const record = await wrapMasterBits(prfOutput, masterBits, credentialId, newPrfInput(), kdf);
    const moved = { ...record, credentialId: 'b3V0cmEtY3JlZGVuY2lhbA==' };
    await expect(unwrapMasterBits(prfOutput, moved)).rejects.toThrow(DecryptionError);
  });

  it('re-pointing the record at another vault generation breaks the AAD', async () => {
    const record = await wrapMasterBits(prfOutput, masterBits, credentialId, newPrfInput(), kdf);
    const repointed = { ...record, kdf: newKdfParams(210_000) };
    await expect(unwrapMasterBits(prfOutput, repointed)).rejects.toThrow(DecryptionError);
  });

  it('survives a JSON round-trip (the localStorage format)', async () => {
    const record = await wrapMasterBits(prfOutput, masterBits, credentialId, newPrfInput(), kdf);
    const revived = JSON.parse(JSON.stringify(record)) as typeof record;
    expect(isBiometricRecord(revived)).toBe(true);
    const opened = await unwrapMasterBits(prfOutput, revived);
    expect(Array.from(opened)).toEqual(Array.from(masterBits));
  });
});

describe('matchesVault', () => {
  it('accepts the vault generation it was enrolled for and rejects others', async () => {
    const record = await wrapMasterBits(randomBytes(32), randomBytes(32), 'aWQ=', newPrfInput(), kdf);
    expect(matchesVault(record, kdf)).toBe(true);
    // A password change re-salts the KDF; the record must read as stale.
    expect(matchesVault(record, newKdfParams(210_000))).toBe(false);
  });
});

describe('isBiometricRecord', () => {
  it('rejects malformed values', () => {
    expect(isBiometricRecord(null)).toBe(false);
    expect(isBiometricRecord({})).toBe(false);
    expect(isBiometricRecord({ version: 2 })).toBe(false);
  });
});
