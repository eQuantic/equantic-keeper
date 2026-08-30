/**
 * Country flags as inline SVG, one per DOCUMENT_ORIGINS code.
 *
 * Not emoji: on Windows and Android the flag sequences degrade to bare letter
 * pairs, and this app renders a country next to every document — a marker that
 * disappears on half the platforms is worse than no marker. These are drawn at
 * list-row size (16px wide), so they are readable simplifications rather than
 * heraldic reproductions: proportions and colours are right, fine detail
 * (Portugal's armillary sphere, Brazil's motto, the US star field) is not.
 */

const FLAGS: Record<string, React.ReactNode> = {
  PT: (
    <>
      <rect width="24" height="16" fill="#c8102e" />
      <rect width="9.6" height="16" fill="#046a38" />
      <circle cx="9.6" cy="8" r="3.4" fill="#ffe600" />
      <circle cx="9.6" cy="8" r="2.1" fill="#fff" />
      <circle cx="9.6" cy="8" r="1.4" fill="#c8102e" />
    </>
  ),
  BR: (
    <>
      <rect width="24" height="16" fill="#009c3b" />
      <path d="M12 2.2 21.6 8 12 13.8 2.4 8Z" fill="#ffdf00" />
      <circle cx="12" cy="8" r="3.1" fill="#002776" />
      <path d="M9.1 6.9c2 -0.9 4.4 -0.6 5.9 0.6" stroke="#fff" strokeWidth="0.9" fill="none" />
    </>
  ),
  ES: (
    <>
      <rect width="24" height="16" fill="#aa151b" />
      <rect y="4" width="24" height="8" fill="#f1bf00" />
    </>
  ),
  US: (
    <>
      <rect width="24" height="16" fill="#fff" />
      {[0, 2, 4, 6].map((row) => (
        <rect key={row} y={row * 2.286} width="24" height="2.286" fill="#b31942" />
      ))}
      <rect width="10.5" height="8" fill="#0a3161" />
      {[1.6, 4, 6.4, 8.8].map((x) =>
        [1.6, 4, 6.4].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.5" fill="#fff" />),
      )}
    </>
  ),
  FR: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="8" height="16" fill="#002395" />
      <rect x="16" width="8" height="16" fill="#ed2939" />
    </>
  ),
  DE: (
    <>
      <rect width="24" height="16" fill="#000" />
      <rect y="5.33" width="24" height="5.33" fill="#dd0000" />
      <rect y="10.66" width="24" height="5.34" fill="#ffce00" />
    </>
  ),
  IT: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="8" height="16" fill="#008c45" />
      <rect x="16" width="8" height="16" fill="#cd212a" />
    </>
  ),
  BE: (
    <>
      <rect width="24" height="16" fill="#fdda24" />
      <rect width="8" height="16" fill="#000" />
      <rect x="16" width="8" height="16" fill="#ef3340" />
    </>
  ),
  NL: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="24" height="5.33" fill="#ae1c28" />
      <rect y="10.66" width="24" height="5.34" fill="#21468b" />
    </>
  ),
  LU: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="24" height="5.33" fill="#ed2939" />
      <rect y="10.66" width="24" height="5.34" fill="#00a1de" />
    </>
  ),
  IE: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="8" height="16" fill="#169b62" />
      <rect x="16" width="8" height="16" fill="#ff883e" />
    </>
  ),
  AT: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="24" height="5.33" fill="#ed2939" />
      <rect y="10.66" width="24" height="5.34" fill="#ed2939" />
    </>
  ),
  CH: (
    <>
      <rect width="24" height="16" fill="#d52b1e" />
      <path d="M12 4v8M8 8h8" stroke="#fff" strokeWidth="2.6" />
    </>
  ),
  PL: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#dc143c" />
    </>
  ),
  UA: (
    <>
      <rect width="24" height="16" fill="#ffd700" />
      <rect width="24" height="8" fill="#0057b7" />
    </>
  ),
  SE: (
    <>
      <rect width="24" height="16" fill="#006aa7" />
      <path d="M8 0v16M0 8h24" stroke="#fecc00" strokeWidth="2.8" />
    </>
  ),
  DK: (
    <>
      <rect width="24" height="16" fill="#c8102e" />
      <path d="M8 0v16M0 8h24" stroke="#fff" strokeWidth="2.8" />
    </>
  ),
  NO: (
    <>
      <rect width="24" height="16" fill="#ba0c2f" />
      <path d="M8 0v16M0 8h24" stroke="#fff" strokeWidth="3.6" />
      <path d="M8 0v16M0 8h24" stroke="#00205b" strokeWidth="1.8" />
    </>
  ),
  FI: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <path d="M8 0v16M0 8h24" stroke="#003580" strokeWidth="2.8" />
    </>
  ),
  IS: (
    <>
      <rect width="24" height="16" fill="#02529c" />
      <path d="M8 0v16M0 8h24" stroke="#fff" strokeWidth="3.6" />
      <path d="M8 0v16M0 8h24" stroke="#dc1e35" strokeWidth="1.8" />
    </>
  ),
  GR: (
    <>
      <rect width="24" height="16" fill="#fff" />
      {[0, 2, 4, 6, 8].map((row) => (
        <rect key={row} y={row * 1.78} width="24" height="1.78" fill="#0d5eaf" />
      ))}
      <rect width="9" height="8.9" fill="#0d5eaf" />
      <path d="M4.5 0v8.9M0 4.45h9" stroke="#fff" strokeWidth="1.8" />
    </>
  ),
  RO: (
    <>
      <rect width="24" height="16" fill="#fcd116" />
      <rect width="8" height="16" fill="#002b7f" />
      <rect x="16" width="8" height="16" fill="#ce1126" />
    </>
  ),
  HU: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="24" height="5.33" fill="#ce2939" />
      <rect y="10.66" width="24" height="5.34" fill="#477050" />
    </>
  ),
  CZ: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#d7141a" />
      <path d="M0 0 12 8 0 16Z" fill="#11457e" />
    </>
  ),
  BG: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="5.33" width="24" height="5.33" fill="#00966e" />
      <rect y="10.66" width="24" height="5.34" fill="#d62612" />
    </>
  ),
  RU: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="5.33" width="24" height="5.33" fill="#0039a6" />
      <rect y="10.66" width="24" height="5.34" fill="#d52b1e" />
    </>
  ),
  JP: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <circle cx="12" cy="8" r="4.4" fill="#bc002d" />
    </>
  ),
  CN: (
    <>
      <rect width="24" height="16" fill="#ee1c25" />
      <circle cx="5" cy="4.4" r="2.2" fill="#ffde00" />
      <circle cx="9.4" cy="2" r="0.7" fill="#ffde00" />
      <circle cx="11" cy="4.2" r="0.7" fill="#ffde00" />
      <circle cx="10.6" cy="7" r="0.7" fill="#ffde00" />
      <circle cx="8.6" cy="8.6" r="0.7" fill="#ffde00" />
    </>
  ),
  AR: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="24" height="5.33" fill="#74acdf" />
      <rect y="10.66" width="24" height="5.34" fill="#74acdf" />
      <circle cx="12" cy="8" r="1.7" fill="#f6b40e" />
    </>
  ),
  CL: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect y="8" width="24" height="8" fill="#d52b1e" />
      <rect width="8" height="8" fill="#0039a6" />
      <circle cx="4" cy="4" r="1.6" fill="#fff" />
    </>
  ),
  CO: (
    <>
      <rect width="24" height="16" fill="#fcd116" />
      <rect y="8" width="24" height="4" fill="#003893" />
      <rect y="12" width="24" height="4" fill="#ce1126" />
    </>
  ),
  MX: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="8" height="16" fill="#006847" />
      <rect x="16" width="8" height="16" fill="#ce1126" />
      <circle cx="12" cy="8" r="1.9" fill="none" stroke="#8b5a2b" strokeWidth="1.1" />
    </>
  ),
  PE: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="8" height="16" fill="#d91023" />
      <rect x="16" width="8" height="16" fill="#d91023" />
    </>
  ),
  UY: (
    <>
      <rect width="24" height="16" fill="#fff" />
      {[1, 3, 5, 7].map((row) => (
        <rect key={row} y={row * 1.78} width="24" height="1.78" fill="#0038a8" />
      ))}
      <rect width="10" height="8.9" fill="#fff" />
      <circle cx="5" cy="4.45" r="2" fill="#fcd116" />
    </>
  ),
  IN: (
    <>
      <rect width="24" height="16" fill="#fff" />
      <rect width="24" height="5.33" fill="#ff9933" />
      <rect y="10.66" width="24" height="5.34" fill="#138808" />
      <circle cx="12" cy="8" r="1.9" fill="none" stroke="#000080" strokeWidth="0.9" />
    </>
  ),
  GB: (
    <>
      <rect width="24" height="16" fill="#012169" />
      <path d="M0 0 24 16M24 0 0 16" stroke="#fff" strokeWidth="3.2" />
      <path d="M0 0 24 16M24 0 0 16" stroke="#c8102e" strokeWidth="1.6" />
      <path d="M12 0V16M0 8H24" stroke="#fff" strokeWidth="5.3" />
      <path d="M12 0V16M0 8H24" stroke="#c8102e" strokeWidth="3.2" />
    </>
  ),
};

/**
 * The country's mark wherever one is shown: the flag when we have drawn it,
 * and the two-letter code in a tile when we have not — 200-odd countries are
 * selectable, and only the likely ones are worth drawing by hand.
 */
export function CountryMark({ code, size = 16, title }: { code: string; size?: number; title?: string }) {
  if (!code) return null;
  if (hasFlag(code)) return <Flag code={code} size={size} title={title} />;
  return (
    <span
      aria-label={title ?? code}
      role="img"
      className="inline-flex shrink-0 items-center justify-center rounded-[2px] border border-line bg-raised font-medium text-faint"
      style={{ width: size, height: (size * 2) / 3, fontSize: Math.round(size * 0.5) }}
    >
      {code}
    </span>
  );
}

export function hasFlag(code: string): boolean {
  return code in FLAGS;
}

export function Flag({ code, size = 16, title }: { code: string; size?: number; title?: string }) {
  const art = FLAGS[code];
  if (!art) return null;
  return (
    <svg
      viewBox="0 0 24 16"
      width={size}
      height={(size * 2) / 3}
      className="shrink-0 overflow-hidden rounded-[2px]"
      role="img"
      aria-label={title ?? code}
    >
      {title ? <title>{title}</title> : null}
      {art}
      <rect width="24" height="16" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1" />
    </svg>
  );
}
