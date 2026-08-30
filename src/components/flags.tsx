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
