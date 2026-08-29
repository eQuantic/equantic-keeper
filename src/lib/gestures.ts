/**
 * Pure math for the touch gestures: row swipes and pull-to-sync. The DOM
 * wiring lives in the components; keeping the numbers here makes the
 * thresholds testable and the two gestures consistent.
 */

export interface SwipeConfig {
  /** How far the row travels when the left-swipe actions are open (px). */
  openLeft: number;
  /** How far it travels when the right-swipe action is open (px). */
  openRight: number;
  /** Full-swipe distance that commits the primary action directly (px). */
  commitLeft: number;
  commitRight: number;
}

export const ROW_SWIPE: SwipeConfig = {
  openLeft: 152, // two 76px action tiles
  openRight: 96, // one favorite tile
  commitLeft: 260,
  commitRight: 200,
};

/**
 * Follows the finger 1:1 until the actions are fully revealed, then adds
 * resistance so the row never flies off the screen.
 */
export function clampOffset(dx: number, config: SwipeConfig = ROW_SWIPE): number {
  const limit = dx < 0 ? config.openLeft : config.openRight;
  const magnitude = Math.abs(dx);
  if (magnitude <= limit) return dx;
  const over = Math.min((magnitude - limit) * 0.3, 48);
  return Math.sign(dx) * (limit + over);
}

export type SwipeResolution = 'commit-left' | 'commit-right' | 'open-left' | 'open-right' | 'closed';

/** Where the row should settle when the finger lifts at `offset`. */
export function resolveSwipe(offset: number, config: SwipeConfig = ROW_SWIPE): SwipeResolution {
  if (offset <= -config.commitLeft) return 'commit-left';
  if (offset >= config.commitRight) return 'commit-right';
  if (offset <= -config.openLeft / 2) return 'open-left';
  if (offset >= config.openRight / 2) return 'open-right';
  return 'closed';
}

export const PULL_THRESHOLD = 72;
const PULL_MAX = 110;

/** Finger travel → indicator height, with resistance and a hard cap. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(dy * 0.5, PULL_MAX);
}

export function pullArmed(distance: number): boolean {
  return distance >= PULL_THRESHOLD;
}
