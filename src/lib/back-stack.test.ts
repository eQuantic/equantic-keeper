import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackStack } from './back-stack';

/**
 * The fake history queues back() calls; the test delivers them by calling
 * handlePop(), the way the browser would fire popstate asynchronously.
 */
let stack: BackStack;
let pushState: ReturnType<typeof vi.fn<(data: unknown, unused: string) => void>>;
let backCalls: number;

beforeEach(() => {
  pushState = vi.fn<(data: unknown, unused: string) => void>();
  backCalls = 0;
  stack = new BackStack({
    pushState,
    back: () => {
      backCalls += 1;
    },
  });
});

describe('BackStack', () => {
  it('a real pop closes the topmost overlay', () => {
    const close = vi.fn();
    stack.push(close);
    expect(pushState).toHaveBeenCalledTimes(1);

    stack.handlePop(); // user pressed back
    expect(close).toHaveBeenCalledTimes(1);
    expect(stack.depth).toBe(0);
  });

  it('closing via the UI consumes the entry with a synthetic back', () => {
    const close = vi.fn();
    const release = stack.push(close);

    release(); // user tapped the X
    expect(backCalls).toBe(1);

    stack.handlePop(); // the synthetic pop arrives
    expect(close).not.toHaveBeenCalled();
    expect(stack.depth).toBe(0);
  });

  it('release after a real pop does not navigate again', () => {
    const close = vi.fn();
    const release = stack.push(close);

    stack.handlePop();
    release(); // effect cleanup after the pop already closed it
    expect(backCalls).toBe(0);
  });

  it('release is idempotent', () => {
    const release = stack.push(vi.fn());
    release();
    release();
    expect(backCalls).toBe(1);
  });

  it('stacked overlays close in LIFO order', () => {
    const drawer = vi.fn();
    const dialog = vi.fn();
    stack.push(drawer);
    stack.push(dialog);

    stack.handlePop();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(drawer).not.toHaveBeenCalled();

    stack.handlePop();
    expect(drawer).toHaveBeenCalledTimes(1);
  });

  it('survives StrictMode-style mount → unmount → mount', () => {
    const close = vi.fn();
    const release1 = stack.push(close); // dev mount
    release1(); // dev cleanup queues a synthetic back
    stack.push(close); // dev re-mount, before the pop arrives

    stack.handlePop(); // the queued synthetic pop — must be swallowed
    expect(close).not.toHaveBeenCalled();
    expect(stack.depth).toBe(1);

    stack.handlePop(); // the user's actual back
    expect(close).toHaveBeenCalledTimes(1);
    expect(stack.depth).toBe(0);
  });

  it('a pop with nothing open falls through', () => {
    expect(() => stack.handlePop()).not.toThrow();
  });
});
