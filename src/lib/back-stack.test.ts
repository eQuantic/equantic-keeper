import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackStack } from './back-stack';

/**
 * The fake history counts calls; the test delivers each traversal's popstate
 * by calling handlePop(), the way the browser would — asynchronously, one
 * per back().
 */
let stack: BackStack;
let pushState: ReturnType<typeof vi.fn>;
let backCalls: number;

beforeEach(() => {
  pushState = vi.fn();
  backCalls = 0;
  stack = new BackStack({
    pushState: pushState as unknown as (data: unknown, unused: string) => void,
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

  it('closing via the UI consumes the entry with one synthetic back', () => {
    const close = vi.fn();
    const release = stack.push(close);

    release(); // user tapped the X
    expect(backCalls).toBe(1);

    stack.handlePop(); // the traversal lands
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

  it('serializes traversals: one back() in flight at a time', () => {
    // Three overlays release together and a fourth pushes right after — the
    // wizard-into-editor swap that used to walk the app out of the document.
    const releases = [stack.push(vi.fn()), stack.push(vi.fn()), stack.push(vi.fn())];
    for (const release of releases) release();
    expect(backCalls).toBe(1); // the rest wait for the first popstate

    const editorClose = vi.fn();
    stack.push(editorClose); // queued behind the pending traversals
    expect(pushState).toHaveBeenCalledTimes(3); // not yet executed

    stack.handlePop(); // traversal 1 lands
    expect(backCalls).toBe(2);
    stack.handlePop(); // traversal 2 lands
    expect(backCalls).toBe(3);
    stack.handlePop(); // traversal 3 lands → now the push executes, settled
    expect(pushState).toHaveBeenCalledTimes(4);
    expect(stack.depth).toBe(1);

    stack.handlePop(); // user back closes the editor
    expect(editorClose).toHaveBeenCalledTimes(1);
    expect(stack.depth).toBe(0);
  });

  it('a push released while still queued never touches the history', () => {
    // StrictMode-style mount → unmount before the queue drains.
    const release1 = stack.push(vi.fn());
    release1(); // back queued + in flight
    const close = vi.fn();
    const release2 = stack.push(close); // queued behind the traversal
    release2(); // cancels the queued push outright
    expect(pushState).toHaveBeenCalledTimes(1);

    stack.handlePop(); // the one traversal lands
    expect(backCalls).toBe(1);
    expect(stack.depth).toBe(0);
  });

  it('a pop with nothing owned falls through to the browser', () => {
    expect(() => stack.handlePop()).not.toThrow();
    const close = vi.fn();
    stack.push(close);
    stack.handlePop();
    stack.handlePop(); // beyond our entries
    expect(close).toHaveBeenCalledTimes(1);
  });
});
