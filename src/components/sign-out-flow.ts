import { signOutPrompt, type SignOutMode } from '../lib/sign-out';
import type { KeeperActions } from '../state/keeper';

/**
 * Asks, then leaves — the one path every door goes through, so the words a
 * person reads before losing something cannot drift between the sidebar, the
 * unlock screen and Advanced.
 *
 * Resolves true when the device was actually signed out, so a caller that
 * lives inside a dialog knows whether to close it.
 */
export async function signOutFlow(
  actions: Pick<KeeperActions, 'signOutRisk' | 'signOutOfDevice'>,
  mode: SignOutMode,
  service: string,
): Promise<boolean> {
  const prompt = signOutPrompt(await actions.signOutRisk(), mode, service);
  if (prompt.kind === 'refuse') {
    window.alert(prompt.message);
    return false;
  }
  if (!window.confirm(prompt.message)) return false;
  await actions.signOutOfDevice();
  return true;
}
