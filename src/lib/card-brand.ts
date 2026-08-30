/**
 * Card network detection from the number prefix (BIN ranges) — pure math,
 * entirely on the device: nothing about the card ever leaves the vault.
 *
 * Deliberately NOT here: issuing-bank identification. That takes an external
 * BIN database — the CSP blocks the call, and shipping the first digits of a
 * card to a third party would break the zero-knowledge promise. The card's
 * color is a user choice instead (see the `cardColor` field).
 *
 * Networks render as neutral TEXT wordmarks, never the registered logos.
 */

export interface CardBrand {
  id: 'visa' | 'mastercard' | 'amex' | 'elo' | 'diners' | 'discover' | 'hipercard';
  wordmark: string;
}

const BRANDS: Record<CardBrand['id'], CardBrand> = {
  visa: { id: 'visa', wordmark: 'VISA' },
  mastercard: { id: 'mastercard', wordmark: 'MASTERCARD' },
  amex: { id: 'amex', wordmark: 'AMEX' },
  elo: { id: 'elo', wordmark: 'ELO' },
  diners: { id: 'diners', wordmark: 'DINERS' },
  discover: { id: 'discover', wordmark: 'DISCOVER' },
  hipercard: { id: 'hipercard', wordmark: 'HIPERCARD' },
};

/** Well-known Elo prefixes; Elo MUST be tested before Visa (4…) and Discover (65…). */
const ELO_EXACT = new Set([
  '401178',
  '401179',
  '431274',
  '438935',
  '451416',
  '457393',
  '457631',
  '457632',
  '504175',
  '627780',
  '636297',
  '636368',
]);
const ELO_RANGES: [number, number][] = [
  [506699, 506778],
  [509000, 509999],
  [650031, 650033],
  [650035, 650051],
  [650405, 650439],
  [650485, 650538],
  [650541, 650598],
  [650700, 650718],
  [650720, 650727],
  [650901, 650978],
  [651652, 651679],
  [655000, 655019],
  [655021, 655058],
];

function inRange(prefix: number, ranges: [number, number][]): boolean {
  return ranges.some(([from, to]) => prefix >= from && prefix <= to);
}

export function detectCardBrand(number: string): CardBrand | null {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 4) return null;

  const p2 = Number(digits.slice(0, 2));
  const p3 = Number(digits.slice(0, 3));
  const p4 = Number(digits.slice(0, 4));
  const p6 = Number(digits.slice(0, 6).padEnd(6, '0'));

  if (ELO_EXACT.has(digits.slice(0, 6)) || inRange(p6, ELO_RANGES)) return BRANDS.elo;
  if (digits.startsWith('606282') || /^3841(0|4|6)0/.test(digits)) return BRANDS.hipercard;
  if (p2 === 34 || p2 === 37) return BRANDS.amex;
  if ((p3 >= 300 && p3 <= 305) || p4 === 3095 || p2 === 36 || p2 === 38 || p2 === 39) return BRANDS.diners;
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return BRANDS.mastercard;
  if (p4 === 6011 || (p6 >= 622126 && p6 <= 622925) || (p3 >= 644 && p3 <= 649) || p2 === 65) {
    return BRANDS.discover;
  }
  if (digits.startsWith('4')) return BRANDS.visa;
  return null;
}

/**
 * The masked groups shown on the card face: everything hidden but the last
 * four (Amex: last five, in its 4-6-5 grouping).
 */
export function maskCardNumber(number: string): string {
  const digits = number.replace(/\D/g, '');
  if (!digits) return '••••  ••••  ••••  ••••';
  const brand = detectCardBrand(digits);
  if (brand?.id === 'amex') {
    const tail = digits.slice(-5).padStart(5, '•');
    return `••••  ••••••  ${tail}`;
  }
  const tail = digits.slice(-4).padStart(4, '•');
  return `••••  ••••  ••••  ${tail}`;
}

/** "2028-09-30" → "09/28", for the card face. */
export function cardExpiryLabel(expiresAt: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(expiresAt.trim());
  if (!match) return '';
  return `${match[2]}/${match[1]?.slice(2)}`;
}
