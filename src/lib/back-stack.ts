/**
 * Makes the system back gesture close the topmost overlay instead of leaving
 * the app: each open overlay pushes one same-URL history entry, and popping
 * it runs that overlay's close handler.
 *
 * Everything that touches the history goes through ONE serialized queue, and
 * only one traversal is ever in flight. That is not pedantry: history.back()
 * is asynchronous, and firing several of them around a pushState — exactly
 * what happens when a wizard full of overlays swaps into another dialog —
 * interleaves nondeterministically, corrupts the position accounting and can
 * walk the session right out of the document (a real bug caught by the smoke
 * suite: the app ended on about:blank). Two more properties fall out of the
 * queue: a push and its release that meet while still queued cancel each
 * other without touching the history at all (which absorbs React StrictMode's
 * dev-only mount→unmount→mount), and a pop that arrives when we own no
 * entries is left to the browser.
 */
export interface HistoryLike {
  pushState(data: unknown, unused: string): void;
  back(): void;
}

type Op = { kind: 'push'; onBack: () => void } | { kind: 'back' };

export class BackStack {
  private handlers: (() => void)[] = [];
  private queue: Op[] = [];
  /** A back() we issued whose popstate has not landed yet. */
  private inFlight = false;
  /** Our live entries behind the current position. */
  private owned = 0;

  constructor(private readonly history: HistoryLike) {}

  /**
   * Arms one history entry whose pop closes the overlay. Returns a release
   * for when the overlay closes by its own means (X, Esc, save): it consumes
   * the entry with a serialized synthetic back(), so the user never has to
   * press back once per overlay they already closed.
   */
  push(onBack: () => void): () => void {
    const op: Op = { kind: 'push', onBack };
    this.queue.push(op);
    this.process();
    return () => this.release(op, onBack);
  }

  private release(op: Op, onBack: () => void): void {
    const queued = this.queue.indexOf(op);
    if (queued !== -1) {
      // Opened and closed before the push ever executed: pure no-op.
      this.queue.splice(queued, 1);
      return;
    }
    const index = this.handlers.lastIndexOf(onBack);
    if (index === -1) return; // a real pop already consumed it
    this.handlers.splice(index, 1);
    this.queue.push({ kind: 'back' });
    this.process();
  }

  /** Wire this to the window's popstate event. */
  handlePop(): void {
    if (this.inFlight) {
      // The traversal we issued has landed; the entry it consumed was ours.
      this.inFlight = false;
      this.owned -= 1;
      this.process();
      return;
    }
    if (this.owned > 0) {
      this.owned -= 1;
      this.handlers.pop()?.();
      this.process();
      return;
    }
    // Beyond our entries: the browser's own navigation, not ours to handle.
  }

  private process(): void {
    while (!this.inFlight && this.queue.length > 0) {
      const op = this.queue.shift();
      if (!op) return;
      if (op.kind === 'push') {
        this.history.pushState({ keeperOverlay: true }, '');
        this.owned += 1;
        this.handlers.push(op.onBack);
      } else {
        this.inFlight = true;
        this.history.back();
      }
    }
  }

  get depth(): number {
    return this.handlers.length;
  }
}
