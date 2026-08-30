import { afterEach, describe, expect, it, vi } from 'vitest';
import { hapticTick } from './haptics';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hapticTick', () => {
  it('vibrates briefly where the API exists', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    hapticTick();
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('no-ops where it does not (iOS, tests)', () => {
    vi.stubGlobal('navigator', {});
    expect(() => hapticTick()).not.toThrow();
  });

  it('survives a vibration blocked by the browser', () => {
    vi.stubGlobal('navigator', {
      vibrate: () => {
        throw new Error('blocked');
      },
    });
    expect(() => hapticTick()).not.toThrow();
  });
});
