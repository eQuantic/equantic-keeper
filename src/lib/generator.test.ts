import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  buildAlphabet,
  estimateStrength,
  generatePassphrase,
  generatePassword,
  passphraseEntropyBits,
  passwordEntropyBits,
} from './generator';

describe('generatePassword', () => {
  it('honours the requested length', () => {
    for (const length of [8, 24, 64]) {
      expect(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length })).toHaveLength(length);
    }
  });

  it('only uses characters from the selected sets', () => {
    const options = {
      ...DEFAULT_PASSWORD_OPTIONS,
      length: 200,
      uppercase: false,
      symbols: false,
    };
    expect(generatePassword(options)).toMatch(/^[a-z0-9]+$/);
  });

  it('drops ambiguous characters when asked', () => {
    const alphabet = buildAlphabet({ ...DEFAULT_PASSWORD_OPTIONS, avoidAmbiguous: true });
    for (const char of ['O', '0', 'l', '1', 'I']) expect(alphabet).not.toContain(char);
  });

  it('throws when every character set is disabled', () => {
    expect(() =>
      generatePassword({
        ...DEFAULT_PASSWORD_OPTIONS,
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
      }),
    ).toThrow(/conjunto/i);
  });

  it('does not repeat itself across calls', () => {
    const generated = new Set(Array.from({ length: 50 }, () => generatePassword(DEFAULT_PASSWORD_OPTIONS)));
    expect(generated.size).toBe(50);
  });

  it('spreads output across the whole alphabet', () => {
    const options = { ...DEFAULT_PASSWORD_OPTIONS, length: 4000 };
    const alphabet = buildAlphabet(options);
    const used = new Set(generatePassword(options));
    // A biased or truncated sampler would leave part of the alphabet unused.
    expect(used.size).toBeGreaterThan(alphabet.length * 0.9);
  });
});

describe('generatePassphrase', () => {
  it('produces the requested number of words plus the optional number', () => {
    const value = generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 5, separator: '-' });
    expect(value.split('-')).toHaveLength(6);
  });

  it('capitalises when asked', () => {
    const value = generatePassphrase({
      ...DEFAULT_PASSPHRASE_OPTIONS,
      capitalize: true,
      appendNumber: false,
      words: 4,
    });
    for (const word of value.split('-')) expect(word[0]).toBe(word[0]?.toUpperCase());
  });

  it('clamps absurd word counts', () => {
    expect(generatePassphrase({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 1, appendNumber: false }).split('-')).toHaveLength(
      3,
    );
  });
});

describe('entropy', () => {
  it('grows with length and alphabet size', () => {
    const short = passwordEntropyBits({ ...DEFAULT_PASSWORD_OPTIONS, length: 8 });
    const long = passwordEntropyBits({ ...DEFAULT_PASSWORD_OPTIONS, length: 32 });
    expect(long).toBeGreaterThan(short);
    expect(passphraseEntropyBits({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 6 })).toBeGreaterThan(
      passphraseEntropyBits({ ...DEFAULT_PASSPHRASE_OPTIONS, words: 3 }),
    );
  });
});

describe('estimateStrength', () => {
  it('scores a long random password above a common one', () => {
    const weak = estimateStrength('senha123');
    const strong = estimateStrength(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 32 }));
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(weak.score).toBe(0);
  });

  it('penalises repetition', () => {
    expect(estimateStrength('aaaaaaaaaaaaaaaa').bits).toBeLessThan(estimateStrength('kt9wPz4mQx7bLd2f').bits);
  });

  it('reports an empty password', () => {
    expect(estimateStrength('')).toMatchObject({ bits: 0, score: 0 });
  });
});
