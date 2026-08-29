/** Clipboard helper that wipes secrets after a timeout. */

let clearTimer: ReturnType<typeof setTimeout> | undefined;
let lastCopied: string | null = null;
/**
 * When the pending wipe is due, in epoch ms. Kept alongside the timer because
 * phones suspend timers the moment the user switches away to paste — which is
 * exactly how a copied secret gets used.
 */
let clearDeadline = 0;
let watchingVisibility = false;

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
  clearTimeout(clearTimer);
  clearDeadline = 0;
  if (clearAfterSeconds > 0) {
    clearDeadline = Date.now() + clearAfterSeconds * 1000;
    clearTimer = setTimeout(() => void clearClipboard(value), clearAfterSeconds * 1000);
    watchVisibility();
  }
  return { ok: true };
}

/**
 * A backgrounded tab cannot write to the clipboard even when its throttled
 * timer does fire, so the wipe has to wait for the app to be visible again:
 * overdue wipes run immediately, pending ones are re-armed for the time they
 * have left. Best effort — nothing can clear the OS clipboard from a page the
 * user never returns to.
 */
function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined') return;
  watchingVisibility = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void resumePendingClear();
  });
}

/** Re-checks the pending wipe against the clock. Exposed for tests. */
export async function resumePendingClear(now = Date.now()): Promise<void> {
  if (!lastCopied || clearDeadline === 0) return;
  clearTimeout(clearTimer);
  const remaining = clearDeadline - now;
  if (remaining <= 0) {
    await clearClipboard();
  } else {
    clearTimer = setTimeout(() => void clearClipboard(), remaining);
  }
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
    if (lastCopied === target) {
      lastCopied = null;
      clearDeadline = 0;
    }
  }
}
