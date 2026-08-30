/**
 * The `/` menu: type a slash anywhere and pick what the block becomes.
 * Ported from eQuantic Space (same items, same order) in this app's clothes.
 */
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import type { SlashItem } from '../../lib/editor/slash-items';

export interface SlashMenuRef {
  /** True when the key was ours (arrows, Enter) and must not reach the editor. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const SlashMenu = forwardRef<SlashMenuRef, { items: SlashItem[]; command: (item: SlashItem) => void }>(
  function SlashMenu({ items, command }, ref) {
    const [selected, setSelected] = useState(0);
    useEffect(() => setSelected(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (event.key === 'ArrowUp') {
          setSelected((current) => (current + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === 'ArrowDown') {
          setSelected((current) => (current + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === 'Enter') {
          const item = items[selected];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) return null;

    return (
      <ul
        role="listbox"
        aria-label="Blocos"
        className="animate-in max-h-72 w-64 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-xl"
      >
        {items.map((item, index) => (
          <li key={item.label}>
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setSelected(index)}
              onPointerDown={(event) => {
                event.preventDefault();
                command(item);
              }}
              className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition ${
                index === selected ? 'bg-raised text-ink' : 'text-muted hover:bg-raised hover:text-ink'
              }`}
            >
              <span className="text-sm">{item.label}</span>
              <span className="text-xs text-faint">{item.hint}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  },
);
