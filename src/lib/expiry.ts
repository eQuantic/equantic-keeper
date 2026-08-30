/**
 * What is about to expire.
 *
 * The point of keeping a residence permit in an app is not reading it — it is
 * not being caught by its expiry. So validity is a first-class concept here,
 * not just another date rendered on a detail screen.
 *
 * Only fields that actually mean "valid until" count. Treating every date the
 * same way is how an *issue* date from 2020 ends up flagged in red as expired,
 * which trains the user to ignore the colour exactly when it matters.
 */
import { getType, type VaultItem } from './model';

/** Field ids across the catalogue that carry a validity date. */
const EXPIRY_FIELDS = new Set(['expiresAt', 'endsAt']);

/**
 * Default warning window. Deliberately not 30 days: renewing a residence
 * permit or a passport takes months, and an alert that arrives with four weeks
 * to go is an alert that arrives too late.
 */
export const DEFAULT_WARNING_DAYS = 60;

export type ExpiryStatus = 'expired' | 'soon' | 'ok';

export interface Expiry {
  itemId: string;
  fieldId: string;
  /** The field's label in its type, e.g. "Válido até". */
  label: string;
  /** The stored `YYYY-MM-DD`. */
  date: string;
  /** Whole days from today; negative once it is past. */
  days: number;
  status: ExpiryStatus;
}

export function isExpiryField(fieldId: string): boolean {
  return EXPIRY_FIELDS.has(fieldId);
}

/**
 * Days from `now` to the end of `day`. A document is valid through the whole of
 * its last day, so the comparison is against that day's end in local time —
 * anything else marks a passport expired on the morning it still works.
 */
/**
 * "2028-09" (a card's printed month) means the last day of that month; a full
 * date is already the day itself. Both shapes live in the vault, so every
 * reader goes through here.
 */
export function endOfPeriod(value: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!month) return value;
  const year = Number(month[1]);
  const index = Number(month[2]);
  // Day 0 of the next month is the last day of this one.
  const last = new Date(year, index, 0).getDate();
  return `${month[1]}-${month[2]}-${String(last).padStart(2, '0')}`;
}

function daysUntil(day: string, now: number): number | null {
  const end = Date.parse(`${endOfPeriod(day)}T23:59:59`);
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - now) / 86_400_000) - 1;
}

export function statusOf(days: number, warningDays: number): ExpiryStatus {
  if (days < 0) return 'expired';
  return days <= warningDays ? 'soon' : 'ok';
}

/**
 * The most pressing validity date of one item, or null when it has none. An
 * item with several (a permit and the contract behind it) is judged by
 * whichever runs out first.
 */
export function expiryOf(
  item: VaultItem,
  warningDays = DEFAULT_WARNING_DAYS,
  now = Date.now(),
): Expiry | null {
  let earliest: Expiry | null = null;

  for (const field of getType(item.type).fields) {
    if ((field.kind !== 'date' && field.kind !== 'month') || !isExpiryField(field.id)) continue;
    const value = (item.fields[field.id] ?? '').trim();
    if (!value) continue;
    const days = daysUntil(value, now);
    if (days === null) continue;

    if (!earliest || days < earliest.days) {
      earliest = {
        itemId: item.id,
        fieldId: field.id,
        label: field.label,
        date: value,
        days,
        status: statusOf(days, warningDays),
      };
    }
  }

  return earliest;
}

/**
 * Everything that needs attention, soonest first. Trashed items are left out:
 * a document on its way to deletion is not something to be reminded about.
 */
export function collectExpiring(
  items: VaultItem[],
  warningDays = DEFAULT_WARNING_DAYS,
  now = Date.now(),
): Expiry[] {
  const found: Expiry[] = [];
  for (const item of items) {
    if (item.deletedAt) continue;
    const expiry = expiryOf(item, warningDays, now);
    if (expiry && expiry.status !== 'ok') found.push(expiry);
  }
  return found.sort((a, b) => a.days - b.days);
}

/** Short, human phrasing for a badge: "vence em 12 dias", "expirou há 3 dias". */
export function describeExpiry({ days }: Pick<Expiry, 'days'>): string {
  if (days < 0) {
    const past = Math.abs(days);
    return past === 1 ? 'expirou ontem' : `expirou há ${past} dias`;
  }
  if (days === 0) return 'expira hoje';
  if (days === 1) return 'expira amanhã';
  if (days < 60) return `expira em ${days} dias`;
  const months = Math.round(days / 30);
  return `expira em ${months} meses`;
}
