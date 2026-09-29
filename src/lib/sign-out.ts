/**
 * Whether leaving this device can cost the person anything.
 *
 * Signing out removes everything of theirs from this browser, which is only
 * safe when the cloud already holds all of it. Three situations, and telling
 * the last two apart is the whole reason this exists:
 *
 *  - nothing here that the cloud lacks: leave;
 *  - edits made here that have not gone up yet: leaving drops them, and the
 *    person has to know that before they press the button, not after;
 *  - a vault that never left this device at all: leaving destroys the only
 *    copy there is. Refused rather than warned about — signing out must never
 *    be the button that deletes someone's vault.
 */
export type SignOutRisk =
  | { kind: 'none' }
  | { kind: 'unsynced'; reason: string }
  | { kind: 'only-copy' };

export interface SignOutFacts {
  /** This device holds a vault of the person's own, open or cached. */
  hasVault: boolean;
  /** It has been uploaded at least once, so the cloud has some version of it. */
  hasRemote: boolean;
  /** Edits exist that the cloud has not received. */
  pending: boolean;
  /** Why they have not gone up, when that is known. */
  reason?: string;
}

export function assessSignOut(facts: SignOutFacts): SignOutRisk {
  // A guest looking at someone else's vault has nothing of their own here: the
  // vault they were reading lives in the owner's cloud, and stays there.
  if (!facts.hasVault) return { kind: 'none' };
  if (!facts.hasRemote) return { kind: 'only-copy' };
  if (facts.pending) {
    return { kind: 'unsynced', reason: facts.reason ?? 'As alterações ainda não chegaram à nuvem.' };
  }
  return { kind: 'none' };
}

/**
 * Which button was pressed. Signing out is the everyday action and refuses to
 * destroy the only copy; wiping is the deliberate one in Advanced, and lets a
 * person throw away a vault that only ever lived here — but only after saying
 * in so many words that it is gone for good.
 */
export type SignOutMode = 'sign-out' | 'wipe';

export type SignOutPrompt = { kind: 'refuse'; message: string } | { kind: 'confirm'; message: string };

/**
 * The words the person reads before anything is deleted.
 *
 * Kept here rather than in a component because what they say is the safety
 * mechanism: the old confirmation in Advanced promised "the copy in the cloud
 * stays intact" to someone whose vault had never been uploaded.
 */
export function signOutPrompt(risk: SignOutRisk, mode: SignOutMode, service: string): SignOutPrompt {
  if (risk.kind === 'only-copy') {
    if (mode === 'sign-out') {
      return {
        kind: 'refuse',
        message:
          `Este cofre só existe neste aparelho: ele nunca foi enviado para o ${service}. ` +
          'Sair agora apagaria o cofre para sempre.\n\n' +
          'Antes de sair, abra o cofre e exporte um backup (Configurações → Backup), ou conecte uma conta ' +
          'para ele subir.',
      };
    }
    return {
      kind: 'confirm',
      message:
        'Este cofre só existe neste aparelho. Apagar agora destrói o cofre para sempre: ' +
        `não há cópia no ${service} nem em lugar nenhum.\n\nApagar mesmo assim?`,
    };
  }
  if (risk.kind === 'unsynced') {
    return {
      kind: 'confirm',
      message:
        `Há alterações feitas neste aparelho que ainda não chegaram ao ${service}. ${risk.reason}\n\n` +
        'Se continuar, elas se perdem. Continuar mesmo assim?',
    };
  }
  return {
    kind: 'confirm',
    message:
      (mode === 'sign-out' ? 'Sair deste aparelho?' : 'Apagar tudo deste aparelho?') +
      `\n\nTudo o que é seu sai deste navegador. O cofre continua no ${service}: ` +
      'para voltar, entre de novo com a conta e a senha mestra.',
  };
}
