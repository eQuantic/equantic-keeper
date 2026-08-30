/**
 * The `/` slash menu as a TipTap extension, ported from eQuantic Space.
 *
 * @tiptap/suggestion watches for the character, filters the shared SLASH_ITEMS
 * by what is typed after it, and runs the picked item's command — which first
 * deletes the typed `/query`, so the block converts instead of keeping the text.
 */
import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion';
import { SLASH_ITEMS, type SlashItem } from '../../lib/editor/slash-items';
import { SlashMenu, type SlashMenuRef } from './slash-menu';

const normalize = (value: string) =>
  value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu, '');

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        // Any prefix, not just after a space: "/" must also convert a block
        // that already has text in front of the caret.
        allowedPrefixes: null,
        items: ({ query }) =>
          SLASH_ITEMS.filter((item) =>
            normalize(`${item.label} ${item.hint}`).includes(normalize(query)),
          ),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<SlashMenuRef> | null = null;
          let popup: HTMLDivElement | null = null;

          const position = (props: SuggestionProps<SlashItem>) => {
            const rect = props.clientRect?.();
            if (!popup || !rect) return;
            // Flip above the caret when the menu would fall off the screen —
            // on a phone the keyboard eats the bottom half of it.
            const below = window.innerHeight - rect.bottom;
            popup.style.left = `${Math.min(rect.left, window.innerWidth - 264)}px`;
            if (below < 300) {
              popup.style.top = '';
              popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
            } else {
              popup.style.bottom = '';
              popup.style.top = `${rect.bottom + 4}px`;
            }
          };

          return {
            onStart: (props) => {
              renderer = new ReactRenderer(SlashMenu, {
                props: { items: props.items, command: (item: SlashItem) => props.command(item) },
                editor: props.editor,
              });
              popup = document.createElement('div');
              popup.style.position = 'fixed';
              popup.style.zIndex = '60';
              popup.appendChild(renderer.element);
              document.body.appendChild(popup);
              position(props);
            },
            onUpdate: (props) => {
              renderer?.updateProps({
                items: props.items,
                command: (item: SlashItem) => props.command(item),
              });
              position(props);
            },
            onKeyDown: (props) => {
              if (props.event.key === 'Escape') return true;
              return renderer?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              popup?.remove();
              popup = null;
              renderer?.destroy();
              renderer = null;
            },
          };
        },
      }),
    ];
  },
});
