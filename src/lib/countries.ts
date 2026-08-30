/**
 * Every country a document can come from.
 *
 * This is a different list from DOCUMENT_ORIGINS: that one is the handful of
 * countries whose paperwork the catalogue models (and whose types the wizard
 * offers), while a *document* can be issued anywhere — a card from Belgium, a
 * diploma from Angola. Keeping the two apart is what stops "meu país não
 * aparece na lista".
 *
 * Names come from the browser's own locale data (Intl.DisplayNames), so they
 * are correct and translated without shipping a table of 200 strings that
 * would go stale; the code itself is the fallback.
 */

/** ISO 3166-1 alpha-2, inhabited territories. */
export const COUNTRY_CODES: string[] = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW',
  'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GT', 'GU',
  'GW', 'GY',
  'HK', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS',
  'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
];

const CODE_SET = new Set(COUNTRY_CODES);

let display: Intl.DisplayNames | null | undefined;

function displayNames(): Intl.DisplayNames | null {
  if (display !== undefined) return display;
  try {
    display = new Intl.DisplayNames(['pt-BR'], { type: 'region' });
  } catch {
    display = null;
  }
  return display;
}

/** "BE" → "Bélgica". Falls back to the code where locale data is missing. */
export function countryName(code: string): string {
  if (!code) return '';
  try {
    return displayNames()?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function isCountryCode(code: string): boolean {
  return CODE_SET.has(code);
}

/** Every country, sorted the way a Portuguese speaker reads a list. */
export function allCountries(): { code: string; name: string }[] {
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' });
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((a, b) =>
    collator.compare(a.name, b.name),
  );
}
