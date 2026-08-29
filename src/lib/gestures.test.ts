import { describe, expect, it } from 'vitest';
import { ROW_SWIPE, clampOffset, pullArmed, pullDistance, resolveSwipe } from './gestures';

describe('clampOffset', () => {
  it('follows the finger 1:1 inside the open distance', () => {
    expect(clampOffset(-100)).toBe(-100);
    expect(clampOffset(50)).toBe(50);
  });

  it('adds resistance past the open distance and caps the overshoot', () => {
    expect(clampOffset(-200)).toBeCloseTo(-(152 + (200 - 152) * 0.3));
    expect(clampOffset(-2000)).toBe(-(152 + 48));
    expect(clampOffset(2000)).toBe(96 + 48);
  });
});

describe('resolveSwipe', () => {
  it('snaps closed on a short drag', () => {
    expect(resolveSwipe(-30)).toBe('closed');
    expect(resolveSwipe(30)).toBe('closed');
  });

  it('opens the actions past half the open distance', () => {
    expect(resolveSwipe(-(ROW_SWIPE.openLeft / 2))).toBe('open-left');
    expect(resolveSwipe(ROW_SWIPE.openRight / 2)).toBe('open-right');
  });

  it('commits the primary action on a full swipe', () => {
    expect(resolveSwipe(-ROW_SWIPE.commitLeft)).toBe('commit-left');
    expect(resolveSwipe(ROW_SWIPE.commitRight)).toBe('commit-right');
  });
});

describe('pull', () => {
  it('ignores upward travel and resists downward travel', () => {
    expect(pullDistance(-40)).toBe(0);
    expect(pullDistance(80)).toBe(40);
    expect(pullDistance(10_000)).toBe(110);
  });

  it('arms at the threshold', () => {
    expect(pullArmed(71)).toBe(false);
    expect(pullArmed(72)).toBe(true);
  });
});
