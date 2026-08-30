/**
 * Pull-to-sync on the vault list: the touch mirror of the header's sync
 * button. Native listeners (not React synthetics) because taking over the
 * scroll needs a non-passive touchmove.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PULL_THRESHOLD, pullArmed, pullDistance } from '../lib/gestures';
import { hapticTick } from '../lib/haptics';
import { Icon } from './icons';

const RING = 2 * Math.PI * 10;

export function PullToSync({
  enabled,
  onSync,
  className,
  children,
}: {
  enabled: boolean;
  onSync: () => Promise<void>;
  className?: string;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const distanceRef = useRef(0);
  const armedRef = useRef(false);
  const syncingRef = useRef(false);
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const [distance, setDistance] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node || !enabled) return;

    const setPull = (value: number) => {
      distanceRef.current = value;
      setDistance(value);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (syncingRef.current || node.scrollTop > 0) return;
      startYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const startY = startYRef.current;
      if (startY === null || syncingRef.current) return;
      const y = event.touches[0]?.clientY ?? startY;
      const dy = y - startY;
      if (dy <= 0 || node.scrollTop > 0) {
        if (distanceRef.current > 0) setPull(0);
        return;
      }
      // Taking over from the native scroll is what lets the indicator grow
      // instead of the page rubber-banding.
      event.preventDefault();
      setPull(pullDistance(dy));

      const armed = pullArmed(distanceRef.current);
      if (armed !== armedRef.current) {
        armedRef.current = armed;
        if (armed) hapticTick();
      }
    };

    const onTouchEnd = () => {
      startYRef.current = null;
      armedRef.current = false;
      if (syncingRef.current) return;
      if (!pullArmed(distanceRef.current)) {
        setPull(0);
        return;
      }
      syncingRef.current = true;
      setSyncing(true);
      setPull(56);
      // The floor keeps a fast sync from flashing the indicator.
      void Promise.allSettled([onSyncRef.current(), new Promise((resolve) => setTimeout(resolve, 600))]).finally(
        () => {
          syncingRef.current = false;
          setSyncing(false);
          setPull(0);
        },
      );
    };

    const onTouchCancel = () => {
      startYRef.current = null;
      armedRef.current = false;
      if (!syncingRef.current) setPull(0);
    };

    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd);
    node.addEventListener('touchcancel', onTouchCancel);
    return () => {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [enabled]);

  const armed = pullArmed(distance);
  const progress = Math.min(distance / PULL_THRESHOLD, 1);

  return (
    <div ref={scrollRef} data-pull className={className}>
      {enabled ? (
        <div
          style={{ height: distance }}
          className={`flex flex-col items-center justify-center gap-1.5 overflow-hidden ${
            distance > 0 ? 'border-b border-line-soft' : ''
          }`}
          aria-hidden={distance === 0}
        >
          {syncing ? (
            <Icon name="refresh" size={20} className="animate-spin text-accent" />
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="-rotate-90">
              <circle cx="12" cy="12" r="10" stroke="var(--color-line)" strokeWidth="3" />
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="var(--color-accent)"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - progress)}
              />
            </svg>
          )}
          <span className="text-[13px] text-muted">
            {syncing ? 'Sincronizando…' : armed ? 'Solte para sincronizar com o Drive' : 'Puxe para sincronizar'}
          </span>
        </div>
      ) : null}
      {children}
    </div>
  );
}
