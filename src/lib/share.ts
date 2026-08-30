/**
 * Sharing a secret or a document out of the vault — through the OS share
 * sheet (`navigator.share`, which is how WhatsApp, Gmail and every other app
 * on the phone are reached) or, where no share sheet exists, a `mailto:`
 * handled by the mail client.
 *
 * Deliberately NOT offered: `wa.me/?text=…` or Gmail-compose links. Those are
 * https navigations, so the plaintext secret would be parked in the browser
 * history — exactly what a vault exists to prevent. `mailto:` is opened by
 * the OS protocol handler and does not enter the history as a navigation.
 */

export interface ShareField {
  label: string;
  value: string;
  /** Concealed in the UI; excluded from sharing unless deliberately ticked. */
  secret: boolean;
}

/** The plain-text body a recipient sees. */
export function buildShareText(name: string, fields: { label: string; value: string }[]): string {
  const lines = fields.map((field) => `${field.label}: ${field.value}`);
  return [name, '', ...lines].join('\n').trim();
}

export function mailtoUrl(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'failed';

function outcomeOf(error: unknown): ShareOutcome {
  // Dismissing the share sheet is a decision, not a failure to report.
  if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
    return 'cancelled';
  }
  return 'failed';
}

export function shareSheetAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export async function shareText(title: string, text: string): Promise<ShareOutcome> {
  if (!shareSheetAvailable()) return 'unsupported';
  try {
    await navigator.share({ title, text });
    return 'shared';
  } catch (error) {
    return outcomeOf(error);
  }
}

export function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files })
  );
}

export async function shareFiles(title: string, files: File[]): Promise<ShareOutcome> {
  if (!shareSheetAvailable()) return 'unsupported';
  try {
    await navigator.share({ title, files });
    return 'shared';
  } catch (error) {
    return outcomeOf(error);
  }
}
