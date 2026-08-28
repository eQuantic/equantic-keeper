/** Inline stroke icons (24x24 grid) — no icon package, no extra network hop. */
import type { SVGProps } from 'react';

const PATHS: Record<string, string[]> = {
  key: ['M15.5 8.5a3.5 3.5 0 1 1-3.4 4.4L9 16h-2v2H5v2H2v-3l7.1-7.1A3.5 3.5 0 0 1 15.5 8.5Z', 'M16 9h.01'],
  app: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M16.5 13.5v6', 'M13.5 16.5h6'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z'],
  container: ['M3 8.5 12 4l9 4.5v7L12 20l-9-4.5z', 'M3 8.5 12 13l9-4.5', 'M12 13v7'],
  cloud: ['M17.5 19a4.5 4.5 0 0 0 .5-8.97A6 6 0 0 0 6.2 11.2 3.9 3.9 0 0 0 6.5 19z'],
  terminal: ['M5 7l5 5-5 5', 'M13 17h6'],
  database: ['M12 8c4.4 0 8-1.34 8-3s-3.6-3-8-3-8 1.34-8 3 3.6 3 8 3Z', 'M20 5v14c0 1.66-3.6 3-8 3s-8-1.34-8-3V5', 'M20 12c0 1.66-3.6 3-8 3s-8-1.34-8-3'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
  shield: ['M12 22s8-3.5 8-9V5.5L12 2 4 5.5V13c0 5.5 8 9 8 9Z', 'M9.5 12.5l2 2 3.5-4'],
  link: ['M10 13a5 5 0 0 0 7.07 0l2-2A5 5 0 0 0 12 4l-1 1', 'M14 11a5 5 0 0 0-7.07 0l-2 2A5 5 0 0 0 12 20l1-1'],
  badge: ['M12 2 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6z', 'M12 8v4', 'M12 15h.01'],
  note: ['M5 3h9l5 5v13H5z', 'M14 3v5h5', 'M8 13h8', 'M8 17h5'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M21 21l-4.3-4.3'],
  copy: ['M9 9h10v12H9z', 'M15 5H5v12'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  eyeOff: ['M10.6 6.2A9.8 9.8 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3 3.6', 'M6.3 7.8A16.7 16.7 0 0 0 2 12s3.6 6 10 6a9.7 9.7 0 0 0 4-.8', 'M3 3l18 18', 'M9.9 10a3 3 0 0 0 4.1 4.2'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  star: ['M12 3.5l2.7 5.5 6 .9-4.35 4.2 1.03 6L12 17.3 6.62 20.1l1.03-6L3.3 9.9l6-.9z'],
  refresh: ['M21 12a9 9 0 1 1-2.6-6.4', 'M21 4v5h-5'],
  lock: ['M6 11h12v10H6z', 'M9 11V8a3 3 0 1 1 6 0v3'],
  unlock: ['M6 11h12v10H6z', 'M9 11V8a3 3 0 0 1 5.6-1.9'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3', 'M4.9 4.9 7 7', 'M17 17l2.1 2.1', 'M19.1 4.9 17 7', 'M7 17l-2.1 2.1'],
  check: ['M4 12.5l5 5L20 6.5'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  upload: ['M12 20V8', 'M7 13l5-5 5 5', 'M4 4h16'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  chevron: ['M9 6l6 6-6 6'],
  warning: ['M12 3 2.5 20h19z', 'M12 9v5', 'M12 17.5h.01'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  tag: ['M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z', 'M7.5 7.5h.01'],
  pencil: ['M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16z', 'M13.5 6.5l4 4'],
  wand: ['M5 19 19 5', 'M15 5h4v4', 'M4 8h3', 'M5.5 6.5v3', 'M9 15h2', 'M10 14v2'],
  google: [
    'M21.6 12.2c0-.7-.06-1.35-.18-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.75 3-4.33 3-7.3Z',
    'M12 22c2.7 0 4.96-.9 6.6-2.43l-3.2-2.5c-.9.6-2.05.95-3.4.95-2.6 0-4.8-1.76-5.6-4.13H3.1v2.6A10 10 0 0 0 12 22Z',
    'M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9z',
    'M12 6.05c1.47 0 2.79.5 3.83 1.5l2.85-2.85C16.95 3.05 14.7 2 12 2 8.1 2 4.72 4.24 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6.05 12 6.05Z',
  ],
  cloudOff: ['M3 3l18 18', 'M17.5 19H6.5a4.5 4.5 0 0 1-.8-8.9', 'M8.6 5.9A6 6 0 0 1 18 10.03 4.5 4.5 0 0 1 20.9 16'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  layers: ['M12 3 2 8l10 5 10-5z', 'M2 14l10 5 10-5', 'M2 11l10 5 10-5'],
};

export type IconName = keyof typeof PATHS | string;

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  /** `google` is a multi-colour brand mark and must be filled, not stroked. */
  filled?: boolean;
}

export function Icon({ name, size = 18, filled, ...rest }: IconProps) {
  const paths = PATHS[name] ?? PATHS.note!;
  const useFill = filled ?? name === 'google';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={useFill ? 'currentColor' : 'none'}
      stroke={useFill ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Brand mark: a shield with a keyhole. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 2.5 5 7v10.2C5 24 10.2 28.4 16 30c5.8-1.6 11-6 11-12.8V7z"
        fill="url(#keeper-gradient)"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1"
      />
      <circle cx="16" cy="14" r="3.2" fill="#0a0d14" fillOpacity="0.85" />
      <path d="M16 16.6v5" stroke="#0a0d14" strokeOpacity="0.85" strokeWidth="2.4" strokeLinecap="round" />
      <defs>
        <linearGradient id="keeper-gradient" x1="5" y1="2.5" x2="27" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7aa2ff" />
          <stop offset="1" stopColor="#4661d6" />
        </linearGradient>
      </defs>
    </svg>
  );
}
