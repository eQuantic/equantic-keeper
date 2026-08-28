/** Reveal / copy / TOTP widgets — the pieces that actually touch secrets. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { copySecret } from '../lib/clipboard';
import { generateTotp, parseTotp, secondsRemaining } from '../lib/totp';
import { useKeeper } from '../state/keeper';
import { Icon } from './icons';
import { IconButton } from './ui';

/** Copy-to-clipboard with auto-clear and transient "copied" feedback. */
export function useCopy() {
  const { payload } = useKeeper();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const clearAfter = payload?.preferences.clipboardClearSeconds ?? 30;

  useEffect(() => {
    if (!copiedKey) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 1600);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  const copy = useCallback(
    async (value: string, key = 'default') => {
      const result = await copySecret(value, clearAfter);
      if (result.ok) setCopiedKey(key);
      return result;
    },
    [clearAfter],
  );

  return { copy, copiedKey, clearAfter };
}

export function CopyButton({ value, itemKey, label }: { value: string; itemKey: string; label: string }) {
  const { copy, copiedKey } = useCopy();
  const copied = copiedKey === itemKey;
  return (
    <IconButton
      icon={copied ? 'check' : 'copy'}
      label={copied ? 'Copiado' : label}
      active={copied}
      onClick={() => void copy(value, itemKey)}
    />
  );
}

function mask(value: string): string {
  const length = Math.min(Math.max(value.length, 8), 32);
  return '•'.repeat(length);
}

export function SecretValue({
  value,
  fieldKey,
  secret,
  multiline,
  defaultRevealed,
}: {
  value: string;
  fieldKey: string;
  secret: boolean;
  multiline?: boolean;
  defaultRevealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(!secret || !!defaultRevealed);

  useEffect(() => {
    setRevealed(!secret || !!defaultRevealed);
  }, [defaultRevealed, fieldKey, secret]);

  if (!value) return <span className="text-sm text-faint">—</span>;

  return (
    <div className="group flex items-start gap-2">
      <div className="min-w-0 flex-1">
        {revealed ? (
          multiline ? (
            <pre className="secret-text max-h-64 overflow-auto rounded-lg border border-line-soft bg-canvas p-3 whitespace-pre-wrap text-ink">
              {value}
            </pre>
          ) : (
            <span className="secret-text text-ink">{value}</span>
          )
        ) : (
          <span className="secret-text text-muted select-none">{mask(value)}</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {secret ? (
          <IconButton
            icon={revealed ? 'eyeOff' : 'eye'}
            label={revealed ? 'Ocultar' : 'Revelar'}
            onClick={() => setRevealed((current) => !current)}
          />
        ) : null}
        <CopyButton value={value} itemKey={fieldKey} label="Copiar" />
      </div>
    </div>
  );
}

/** Live TOTP code with the remaining-seconds ring. */
export function TotpCode({ secret, fieldKey }: { secret: string; fieldKey: string }) {
  const [code, setCode] = useState('');
  const [remaining, setRemaining] = useState(30);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  // Parsing is derived state, not an effect: computing it during render keeps
  // an invalid secret from flashing a stale code.
  const parsed = useMemo(() => {
    try {
      return { config: parseTotp(secret), error: null };
    } catch (parseError) {
      return {
        config: null,
        error: parseError instanceof Error ? parseError.message : 'Segredo TOTP inválido.',
      };
    }
  }, [secret]);
  const config = parsed.config;

  useEffect(() => {
    if (!config) return;
    let active = true;

    const tick = async () => {
      try {
        const next = await generateTotp(config);
        if (!active) return;
        setCode(next);
        setRemaining(secondsRemaining(config.period));
        setRuntimeError(null);
      } catch (totpError) {
        if (active) setRuntimeError(totpError instanceof Error ? totpError.message : 'Falha ao gerar o código.');
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [config]);

  const error = parsed.error ?? runtimeError;
  if (error) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-danger">
        <Icon name="warning" size={13} /> {error}
      </span>
    );
  }

  const period = config?.period ?? 30;
  const progress = remaining / period;

  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-lg tracking-[0.3em] text-ink tabular-nums">
        {code ? `${code.slice(0, 3)} ${code.slice(3)}` : '••• •••'}
      </span>
      <span className="relative flex h-6 w-6 items-center justify-center" title={`${remaining}s`}>
        <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90">
          <circle cx="12" cy="12" r="10" fill="none" stroke="var(--color-line)" strokeWidth="3" />
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke={remaining <= 5 ? 'var(--color-warn)' : 'var(--color-accent)'}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 10}
            strokeDashoffset={2 * Math.PI * 10 * (1 - progress)}
          />
        </svg>
      </span>
      <CopyButton value={code} itemKey={fieldKey} label="Copiar código" />
    </div>
  );
}
