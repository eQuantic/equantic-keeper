/** Password / passphrase generator, usable standalone or inside a field. */
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase,
  generatePassword,
  passphraseEntropyBits,
  passwordEntropyBits,
  type PassphraseOptions,
  type PasswordOptions,
} from '../lib/generator';
import { Button, IconButton, Modal, Switch } from './ui';
import { useCopy } from './SecretValue';

type Mode = 'password' | 'passphrase';

export function GeneratorPanel({ onUse }: { onUse?: (value: string) => void }) {
  const [mode, setMode] = useState<Mode>('password');
  const [passwordOptions, setPasswordOptions] = useState<PasswordOptions>(DEFAULT_PASSWORD_OPTIONS);
  const [passphraseOptions, setPassphraseOptions] = useState<PassphraseOptions>(DEFAULT_PASSPHRASE_OPTIONS);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { copy, copiedKey } = useCopy();

  const regenerate = useCallback(() => {
    try {
      setValue(mode === 'password' ? generatePassword(passwordOptions) : generatePassphrase(passphraseOptions));
      setError(null);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : 'Falha ao gerar.');
      setValue('');
    }
  }, [mode, passphraseOptions, passwordOptions]);

  useEffect(regenerate, [regenerate]);

  const bits = mode === 'password' ? passwordEntropyBits(passwordOptions) : passphraseEntropyBits(passphraseOptions);

  return (
    <div className="space-y-4">
      <div className="flex rounded-lg border border-line bg-canvas p-1 text-sm">
        {(['password', 'passphrase'] as Mode[]).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setMode(candidate)}
            className={`flex-1 rounded-md px-3 py-1.5 transition ${
              mode === candidate ? 'bg-accent/15 text-accent' : 'text-muted hover:text-ink'
            }`}
          >
            {candidate === 'password' ? 'Senha' : 'Frase-senha'}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-canvas p-3">
        <div className="flex items-start gap-2">
          <p className="secret-text min-h-[2.5rem] flex-1 leading-relaxed break-all text-ink">
            {error ? <span className="text-danger">{error}</span> : value}
          </p>
          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton icon="refresh" label="Gerar outra" onClick={regenerate} />
            <IconButton
              icon={copiedKey === 'generator' ? 'check' : 'copy'}
              label="Copiar"
              active={copiedKey === 'generator'}
              onClick={() => void copy(value, 'generator')}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-faint">
          Entropia estimada: <span className="text-muted">{bits} bits</span>
        </p>
      </div>

      {mode === 'password' ? (
        <div className="space-y-1">
          <label className="flex items-center justify-between gap-4 py-1 text-sm text-ink">
            <span>Comprimento</span>
            <span className="flex items-center gap-3">
              <input
                type="range"
                min={8}
                max={128}
                value={passwordOptions.length}
                onChange={(event) =>
                  setPasswordOptions((options) => ({ ...options, length: Number(event.target.value) }))
                }
                className="w-40 accent-[var(--color-accent)]"
              />
              <span className="w-8 text-right font-mono text-xs text-muted">{passwordOptions.length}</span>
            </span>
          </label>
          {(
            [
              ['lowercase', 'Minúsculas (a-z)'],
              ['uppercase', 'Maiúsculas (A-Z)'],
              ['digits', 'Números (0-9)'],
              ['symbols', 'Símbolos (!#$…)'],
              ['avoidAmbiguous', 'Evitar caracteres ambíguos'],
            ] as const
          ).map(([key, label]) => (
            <Switch
              key={key}
              label={label}
              checked={passwordOptions[key]}
              onChange={(checked) => setPasswordOptions((options) => ({ ...options, [key]: checked }))}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          <label className="flex items-center justify-between gap-4 py-1 text-sm text-ink">
            <span>Palavras</span>
            <span className="flex items-center gap-3">
              <input
                type="range"
                min={3}
                max={12}
                value={passphraseOptions.words}
                onChange={(event) =>
                  setPassphraseOptions((options) => ({ ...options, words: Number(event.target.value) }))
                }
                className="w-40 accent-[var(--color-accent)]"
              />
              <span className="w-8 text-right font-mono text-xs text-muted">{passphraseOptions.words}</span>
            </span>
          </label>
          <label className="flex items-center justify-between gap-4 py-1 text-sm text-ink">
            <span>Separador</span>
            <input
              value={passphraseOptions.separator}
              onChange={(event) =>
                setPassphraseOptions((options) => ({ ...options, separator: event.target.value.slice(0, 3) }))
              }
              className="w-16 rounded-md border border-line bg-canvas px-2 py-1 text-center font-mono text-sm text-ink"
            />
          </label>
          <Switch
            label="Capitalizar palavras"
            checked={passphraseOptions.capitalize}
            onChange={(checked) => setPassphraseOptions((options) => ({ ...options, capitalize: checked }))}
          />
          <Switch
            label="Acrescentar número no final"
            checked={passphraseOptions.appendNumber}
            onChange={(checked) => setPassphraseOptions((options) => ({ ...options, appendNumber: checked }))}
          />
        </div>
      )}

      {onUse ? (
        <Button variant="primary" className="w-full" icon="check" disabled={!value} onClick={() => onUse(value)}>
          Usar este valor
        </Button>
      ) : null}
    </div>
  );
}

export function GeneratorDialog({
  open,
  onClose,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  onUse?: (value: string) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Gerador" subtitle="Valores aleatórios com crypto.getRandomValues">
      <GeneratorPanel
        {...(onUse
          ? {
              onUse: (value: string) => {
                onUse(value);
                onClose();
              },
            }
          : {})}
      />
    </Modal>
  );
}
