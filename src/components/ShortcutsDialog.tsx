/** The "?" cheat sheet: every keyboard shortcut in one place. */
import { Kbd, Modal } from './ui';

const SHORTCUTS: { label: string; keys: string[]; separator?: string }[] = [
  { label: 'Buscar', keys: ['Ctrl', 'K'] },
  { label: 'Bloquear o cofre', keys: ['Ctrl', 'L'] },
  { label: 'Navegar na lista', keys: ['↑', '↓'], separator: 'ou' },
  { label: 'Abrir o primeiro item', keys: ['↵'] },
  { label: 'Copiar o segredo principal', keys: ['C'] },
  { label: 'Editar o item selecionado', keys: ['E'] },
  { label: 'Favoritar', keys: ['F'] },
  { label: 'Novo item', keys: ['N'] },
  { label: 'Gerador de senhas', keys: ['G'] },
  { label: 'Este painel', keys: ['?'] },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Atalhos do teclado" wide>
      <div className="grid gap-x-10 gap-y-1 sm:grid-cols-2">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.label} className="flex items-center justify-between gap-4 py-2">
            <span className="text-sm text-muted">{shortcut.label}</span>
            <span className="flex items-center gap-1">
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
              {shortcut.separator ? (
                <>
                  <span className="px-0.5 text-xs text-faint">{shortcut.separator}</span>
                  <Kbd>J</Kbd>
                  <Kbd>K</Kbd>
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 border-t border-line-soft pt-3 text-xs text-faint">
        Atalhos de uma tecla ficam inativos enquanto um campo de texto está focado.
      </p>
    </Modal>
  );
}
