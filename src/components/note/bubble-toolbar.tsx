/** Selection toolbar for inline marks — bold, italic, code, strike, link. */
import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/core';
import { Icon } from '../icons';

export function BubbleToolbar({ editor }: { editor: Editor }) {
  const button = (active: boolean, label: string, onClick: () => void, children: React.ReactNode) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // mousedown, not click: the selection must survive the press.
      onMouseDown={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={`tap-target flex h-8 w-8 items-center justify-center rounded-lg text-sm transition ${
        active ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-raised hover:text-ink'
      }`}
    >
      {children}
    </button>
  );

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: 'top' }}
      shouldShow={({ editor: instance, from, to }) => from !== to && !instance.isActive('codeBlockShiki')}
    >
      <div className="animate-in flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-xl">
        {button(editor.isActive('bold'), 'Negrito', () => editor.chain().focus().toggleBold().run(), (
          <span className="font-bold">B</span>
        ))}
        {button(editor.isActive('italic'), 'Itálico', () => editor.chain().focus().toggleItalic().run(), (
          <span className="italic">I</span>
        ))}
        {button(editor.isActive('strike'), 'Riscado', () => editor.chain().focus().toggleStrike().run(), (
          <span className="line-through">S</span>
        ))}
        {button(editor.isActive('code'), 'Código', () => editor.chain().focus().toggleCode().run(), (
          <Icon name="terminal" size={14} />
        ))}
        {button(
          editor.isActive('link'),
          'Link',
          () => {
            if (editor.isActive('link')) return editor.chain().focus().unsetLink().run();
            const href = window.prompt('Endereço do link');
            if (!href) return;
            // Only what a browser should follow from inside a vault.
            if (!/^(https?:|mailto:)/i.test(href)) return;
            editor.chain().focus().setLink({ href }).run();
          },
          <Icon name="link" size={14} />,
        )}
      </div>
    </BubbleMenu>
  );
}
