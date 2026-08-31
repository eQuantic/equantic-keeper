import { useEffect, useState } from 'react';

/**
 * Reads a media query as state. The note dialog needs the ANSWER, not just a
 * CSS class: below a breakpoint a column does not merely hide — it becomes a
 * drawer, which is different markup and different behaviour.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
