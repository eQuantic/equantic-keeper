/**
 * Input masks for document numbers.
 *
 * A CPF is written `000.000.000-00` on every form the person has ever filled,
 * and a card number in groups of four. Typing it as a bare run of digits and
 * hoping to read it back later is how a transposed pair goes unnoticed — the
 * separators are what make a long number checkable by eye.
 *
 * The pattern language is the usual one: `0` takes a digit, `A` a letter, `*`
 * either, and every other character is a literal that the mask puts in for you.
 * What gets stored is the formatted value, because that is what the person
 * expects to see and to copy; searching still finds it by bare digits (see
 * `search.ts`, which indexes both forms).
 */

const DIGIT = /\d/;
const LETTER = /\p{L}/u;

function accepts(slot: string, char: string): boolean {
  if (slot === '0') return DIGIT.test(char);
  if (slot === 'A') return LETTER.test(char);
  if (slot === '*') return DIGIT.test(char) || LETTER.test(char);
  return false;
}

function isSlot(char: string): boolean {
  return char === '0' || char === 'A' || char === '*';
}

/**
 * Formats as far as the input goes, and no further: a half-typed CPF shows
 * `123.456` rather than `123.456.___-__`. Placeholder tails look like content
 * that is already there, and they fight the caret.
 */
export function applyMask(pattern: string, input: string): string {
  const source = [...input].filter((char) => DIGIT.test(char) || LETTER.test(char));
  let out = '';
  let index = 0;

  for (const slot of pattern) {
    if (index >= source.length) break;
    if (isSlot(slot)) {
      // Skip anything the slot cannot take, so a letter pasted into a digit
      // field does not stop the whole value dead.
      while (index < source.length && !accepts(slot, source[index]!)) index += 1;
      if (index >= source.length) break;
      out += source[index]!;
      index += 1;
    } else {
      out += slot;
    }
  }

  // A literal left dangling at the end ("123." while typing) reads as a typo.
  return out.replace(/[^0-9\p{L}]+$/u, '');
}

/** Just the characters the person typed, without the mask's own punctuation. */
export function stripMask(value: string): string {
  return [...value].filter((char) => DIGIT.test(char) || LETTER.test(char)).join('');
}

/**
 * Where the caret should land after formatting.
 *
 * Counted in typed characters rather than in string positions: inserting a
 * digit in the middle of a CPF can push a dot across the caret, and measuring
 * the raw text either side is the only way the caret does not jump.
 */
export function maskedCaret(formatted: string, typedBeforeCaret: number): number {
  if (typedBeforeCaret <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    const char = formatted[index]!;
    if (DIGIT.test(char) || LETTER.test(char)) {
      seen += 1;
      if (seen === typedBeforeCaret) return index + 1;
    }
  }
  return formatted.length;
}

/** How many significant characters precede `caret` in `value`. */
export function countTyped(value: string, caret: number): number {
  return stripMask(value.slice(0, caret)).length;
}

/* ------------------------------------------------------------------------- *
 * Card numbers: the grouping depends on the brand
 * ------------------------------------------------------------------------- */

/**
 * Amex prints 4-6-5 and Diners 4-6-4; everything else is fours. Read from the
 * digits themselves rather than from the brand field, which the person may not
 * have filled in yet — and which they can set to anything.
 */
export function cardMask(input: string): string {
  const digits = stripMask(input);
  if (/^3[47]/.test(digits)) return '0000 000000 00000';
  if (/^3(?:0[0-5]|[689])/.test(digits)) return '0000 000000 0000';
  return '0000 0000 0000 0000';
}

/** The mask for a field, resolved against what is being typed. */
export function resolveMask(
  field: { mask?: string; dynamicMask?: 'card' },
  value: string,
): string | null {
  if (field.dynamicMask === 'card') return cardMask(value);
  return field.mask ?? null;
}
