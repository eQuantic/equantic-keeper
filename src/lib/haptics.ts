/**
 * One short tick when a gesture crosses its threshold — the finger's version
 * of a hover state. Android Chrome vibrates; iOS exposes no web vibration API
 * and everything else no-ops, so callers never need to feature-check.
 */
export function hapticTick(): void {
  if (typeof navigator === 'undefined') return;
  try {
    navigator.vibrate?.(10);
  } catch {
    /* blocked or unsupported */
  }
}
