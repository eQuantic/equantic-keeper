import { describe, expect, it } from 'vitest';
import { cardExpiryLabel, detectCardBrand, maskCardNumber } from './card-brand';

describe('detectCardBrand', () => {
  it('detects the majors by prefix', () => {
    expect(detectCardBrand('4111 1111 1111 1111')?.id).toBe('visa');
    expect(detectCardBrand('5555555555554444')?.id).toBe('mastercard');
    expect(detectCardBrand('2221000000000009')?.id).toBe('mastercard');
    expect(detectCardBrand('378282246310005')?.id).toBe('amex');
    expect(detectCardBrand('30569309025904')?.id).toBe('diners');
    expect(detectCardBrand('6011111111111117')?.id).toBe('discover');
  });

  it('detects the Brazilian networks', () => {
    expect(detectCardBrand('6362970000457013')?.id).toBe('elo');
    expect(detectCardBrand('5066991111111118')?.id).toBe('elo');
    expect(detectCardBrand('6062825624254001')?.id).toBe('hipercard');
  });

  it('Elo wins over Visa and Discover on shared leading digits', () => {
    // 4… would read as Visa and 65… as Discover without the Elo-first rule.
    expect(detectCardBrand('4011780000000000')?.id).toBe('elo');
    expect(detectCardBrand('6550210000000000')?.id).toBe('elo');
  });

  it('returns null on garbage or too little to tell', () => {
    expect(detectCardBrand('')).toBeNull();
    expect(detectCardBrand('12')).toBeNull();
    expect(detectCardBrand('9999999999999999')).toBeNull();
  });
});

describe('maskCardNumber', () => {
  it('hides everything but the last four, grouped', () => {
    expect(maskCardNumber('4111 1111 1111 1111')).toBe('••••  ••••  ••••  1111');
  });

  it('uses the Amex 4-6-5 grouping with the last five', () => {
    expect(maskCardNumber('378282246310005')).toBe('••••  ••••••  10005');
  });

  it('renders a fully masked face when empty', () => {
    expect(maskCardNumber('')).toBe('••••  ••••  ••••  ••••');
  });
});

describe('cardExpiryLabel', () => {
  it('renders MM/AA from the stored date', () => {
    expect(cardExpiryLabel('2028-09-30')).toBe('09/28');
  });

  it('stays quiet on anything unparseable', () => {
    expect(cardExpiryLabel('em breve')).toBe('');
  });
});
