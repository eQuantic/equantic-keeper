/**
 * Horizontal swipe gestures for a vault list row: right reveals Favoritar,
 * left reveals Copiar + Lixeira. A full swipe commits the FIRST action only —
 * copy on the left, favorite on the right — so the destructive one always
 * takes a deliberate tap. Every action here duplicates a visible control;
 * nothing is gesture-only.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ROW_SWIPE, clampOffset, resolveSwipe, type SwipeConfig } from '../lib/gestures';
import { hapticTick } from '../lib/haptics';
import { Icon } from './icons';

export type SwipeSide = 'left' | 'right';

function ActionTile({
  icon,
  label,
  className,
  onClick,
}: {
  icon: string;
  label: string;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-[76px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${className}`}
    >
      <Icon name={icon} size={20} />
      {label}
    </button>
  );
}

export function SwipeableRow({
  enabled,
  open,
  onOpenChange,
  canCopy,
  onCopy,
  favoriteLabel,
  onFavorite,
  onTrash,
  children,
}: {
  enabled: boolean;
  open: SwipeSide | null;
  onOpenChange: (side: SwipeSide | null) => void;
  canCopy: boolean;
  onCopy: () => void;
  favoriteLabel: string;
  onFavorite: () => void;
  onTrash: () => void;
  children: ReactNode;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const startRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const intentRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const suppressClickRef = useRef(false);
  /** Raw finger travel: the commit thresholds live past the visual clamp. */
  const rawRef = useRef(0);
  const commitZoneRef = useRef(false);

  if (!enabled) return <>{children}</>;

  // Without a copyable secret the left side holds only Lixeira — and a full
  // swipe must never commit it, so the commit threshold moves out of reach.
  const config: SwipeConfig = canCopy
    ? ROW_SWIPE
    : { ...ROW_SWIPE, openLeft: 76, commitLeft: Number.POSITIVE_INFINITY };

  const baseOffset = open === 'left' ? -config.openLeft : open === 'right' ? config.openRight : 0;
  const offset = drag ?? baseOffset;

  const settle = (side: SwipeSide | null) => {
    setDrag(null);
    onOpenChange(side);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    startRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    intentRef.current = 'none';
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || event.pointerId !== start.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (intentRef.current === 'none') {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      intentRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
      if (intentRef.current === 'horizontal') {
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* synthetic pointers (tests) have no capture */
        }
      }
    }
    if (intentRef.current !== 'horizontal') return;
    suppressClickRef.current = true;
    rawRef.current = baseOffset + dx;
    setDrag(clampOffset(rawRef.current, config));

    // A tick the moment the drag enters (or leaves) the commit zone, so the
    // finger knows a full swipe is armed before letting go.
    const resolution = resolveSwipe(rawRef.current, config);
    const inCommitZone =
      (resolution === 'commit-left' && canCopy) || resolution === 'commit-right';
    if (inCommitZone !== commitZoneRef.current) {
      commitZoneRef.current = inCommitZone;
      if (inCommitZone) hapticTick();
    }
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || event.pointerId !== start.pointerId) return;
    startRef.current = null;
    if (intentRef.current !== 'horizontal') return;
    intentRef.current = 'none';

    const resolution = resolveSwipe(rawRef.current, config);
    rawRef.current = 0;
    commitZoneRef.current = false;
    if (resolution === 'commit-left' && canCopy) {
      onCopy();
      settle(null);
    } else if (resolution === 'commit-right') {
      onFavorite();
      settle(null);
    } else if (resolution === 'open-left' || resolution === 'commit-left') {
      settle('left');
    } else if (resolution === 'open-right') {
      settle('right');
    } else {
      settle(null);
    }
  };

  return (
    <div className="relative overflow-hidden">
      {offset < 0 ? (
        <div className="absolute inset-y-0 right-0 flex">
          {canCopy ? (
            <ActionTile
              icon="copy"
              label="Copiar"
              className="bg-accent text-white"
              onClick={() => {
                onCopy();
                settle(null);
              }}
            />
          ) : null}
          <ActionTile
            icon="trash"
            label="Lixeira"
            className="bg-danger text-white"
            onClick={() => {
              onTrash();
              settle(null);
            }}
          />
        </div>
      ) : null}
      {offset > 0 ? (
        <div className="absolute inset-y-0 left-0 flex">
          <ActionTile
            icon="star"
            label={favoriteLabel}
            className="w-24 bg-warn text-canvas"
            onClick={() => {
              onFavorite();
              settle(null);
            }}
          />
        </div>
      ) : null}
      <div
        data-swipe-row
        className="relative bg-canvas [touch-action:pan-y]"
        style={{
          transform: `translateX(${offset}px)`,
          transition: drag !== null ? 'none' : 'transform 180ms ease',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClickCapture={(event) => {
          // A drag or an open row swallows the tap instead of opening the item.
          if (suppressClickRef.current || open) {
            event.preventDefault();
            event.stopPropagation();
            suppressClickRef.current = false;
            if (open) onOpenChange(null);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
