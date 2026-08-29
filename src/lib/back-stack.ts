/**
 * Makes the system back gesture close the topmost overlay instead of leaving
 * the app: each open overlay pushes one same-URL history entry, and popping
 * it runs that overlay's close handler.
 *
 * The stack is counted, not keyed: a pop always closes the topmost overlay,
 * whatever entry object the browser hands back. That is what makes it immune
 * to React StrictMode's mount → unmount → mount in development, where a
 * synthetic back() can consume a different entry than the one just pushed —
 * depth stays balanced either way. Overlays are assumed to close in LIFO
 * order, which holds because a lower overlay's controls are covered by the
 * one above it.
 *
 * Known edge: entries left behind by a reload (or re-entered with the forward
 * button) have no handler and fall through to the browser's own navigation.
 */
export interface HistoryLike {
  pushState(data: unknown, unused: string): void;
  back(): void;
}

export class BackStack {
  private handlers: (() => void)[] = [];
  private syntheticPops = 0;

  constructor(private readonly history: HistoryLike) {}

  /**
   * Pushes one history entry whose pop closes the overlay. Returns a release
   * for when the overlay closes by its own means (X, Esc, save): it consumes
   * the entry with a synthetic back() so the user does not have to press back
   * once per overlay they already closed.
   */
  push(onBack: () => void): () => void {
    this.history.pushState({ keeperOverlay: true }, '');
    this.handlers.push(onBack);
    return () => {
      const index = this.handlers.lastIndexOf(onBack);
      if (index === -1) return; // a real pop already consumed it
      this.handlers.splice(index, 1);
      this.syntheticPops += 1;
      this.history.back();
    };
  }

  /** Wire this to the window's popstate event. */
  handlePop(): void {
    if (this.syntheticPops > 0) {
      this.syntheticPops -= 1;
      return;
    }
    this.handlers.pop()?.();
  }

  get depth(): number {
    return this.handlers.length;
  }
}
