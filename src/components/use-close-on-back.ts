import { useEffect, useRef, useState } from 'react';
import { BackStack } from '../lib/back-stack';

let stack: BackStack | null = null;

function appStack(): BackStack {
  if (!stack) {
    const created = new BackStack(window.history);
    window.addEventListener('popstate', () => created.handlePop());
    stack = created;
  }
  return stack;
}

/**
 * While `active`, the system back gesture/button closes this overlay instead
 * of leaving the app. Scoped to touch-first devices: there, back is the reflex
 * for "dismiss what is on top" — on a desktop it means "leave the page", and
 * hijacking that would be hostile.
 */
export function useCloseOnBack(active: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Bumps when a pop ran but the overlay refused to close (e.g. a dirty-form
  // confirm was declined): the consumed history entry must be re-armed, or
  // the next back would leave the app with the overlay still open.
  const [popCount, setPopCount] = useState(0);

  useEffect(() => {
    if (!active || !window.matchMedia('(pointer: coarse)').matches) return;
    return appStack().push(() => {
      closeRef.current();
      setPopCount((count) => count + 1);
    });
  }, [active, popCount]);
}
