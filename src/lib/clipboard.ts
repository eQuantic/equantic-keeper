/** Clipboard helper that wipes secrets after a timeout. */

let clearTimer: number | undefined;
let lastCopied: string | null = null;

export interface CopyResult {
  ok: boolean;
  error?: string;
}

export async function copySecret(value: string, clearAfterSeconds: number): Promise<CopyResult> {
  if (!value) return { ok: false, error: 'Nada para copiar.' };
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    return { ok: false, error: 'O navegador bloqueou o acesso à área de transferência.' };
  }

  lastCopied = value;
  window.clearTimeout(clearTimer);
  if (clearAfterSeconds > 0) {
    clearTimer = window.setTimeout(() => void clearClipboard(value), clearAfterSeconds * 1000);
  }
  return { ok: true };
}

/**
 * Only clears when the clipboard still holds our secret. Reading it back needs
 * a permission most browsers deny silently; when we cannot check, we clear
 * anyway, because leaving a private key on the clipboard is the worse outcome.
 */
export async function clearClipboard(expected?: string): Promise<void> {
  const target = expected ?? lastCopied;
  if (!target) return;
  try {
    const status = await navigator.permissions
      ?.query({ name: 'clipboard-read' as PermissionName })
      .catch(() => null);
    if (status?.state === 'granted') {
      const current = await navigator.clipboard.readText();
      if (current !== target) return;
    }
    await navigator.clipboard.writeText('');
  } catch {
    /* clipboard unavailable (background tab, permission denied) */
  } finally {
    if (lastCopied === target) lastCopied = null;
  }
}
