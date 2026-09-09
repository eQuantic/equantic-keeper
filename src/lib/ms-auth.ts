/**
 * Microsoft sign-in: OAuth 2 authorization code with PKCE, in a popup.
 *
 * No library. MSAL would bring a few hundred kilobytes and a cache of its own
 * to do what is written below in one file, and this app already owns an
 * equivalent for Google — two auth stacks with two mental models would cost
 * more than the code they save.
 *
 * No client secret either, and there cannot be one: a static site has nowhere
 * to keep it. PKCE is what replaces it — a random verifier stays in this tab,
 * only its hash travels to Microsoft, and the code that comes back is worthless
 * to anyone who did not generate the verifier.
 *
 * The popup lands back on this same origin carrying the code. The app boots
 * inside that popup, recognises itself as a callback (see `main.tsx`), hands the
 * code to the opener and closes. That is why the redirect URI registered in
 * Entra is the app's own address and not a page of its own.
 */
import { randomBytes, toBase64 } from './crypto';
import type { AccountAuth, ProviderAccount } from './storage-provider';

const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me';

/**
 * `Files.ReadWrite.AppFolder` is the app's own folder and nothing else — the
 * exact counterpart of Drive's appDataFolder. `offline_access` is what makes a
 * refresh possible without a click; `User.Read` only names the account on
 * screen. Nothing here can reach the rest of someone's OneDrive.
 */
export const MS_SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read', 'offline_access', 'openid', 'profile'];

/** Marks a callback as ours, and ties it to the request that started it. */
export const MS_STATE_PREFIX = 'keeper-ms:';

export class MicrosoftAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'MicrosoftAuthError';
  }
}

function base64url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Holds the Microsoft tokens for this session and knows how to renew them.
 *
 * The refresh token lives in memory, like the access token. Persisting it would
 * spare the person a click after every reload — Microsoft, unlike Google, hands
 * one out — but a refresh token written to disk is a standing key to their
 * files, and that trade deserves to be decided on its own rather than smuggled
 * in with a new provider.
 */
export class MicrosoftAuth implements AccountAuth {
  private token: string | null = null;
  private refresh: string | null = null;
  private expiresAt = 0;
  private pending: Promise<string> | null = null;

  constructor(readonly clientId: string) {}

  get isSignedIn(): boolean {
    return !!this.token && Date.now() < this.expiresAt;
  }

  /** True when a token can be had without asking the person for anything. */
  get canRenew(): boolean {
    return !!this.refresh;
  }

  /**
   * @param interactive `false` uses what is in memory, including a silent
   * refresh — which needs no window and so no gesture. Only a first sign-in,
   * or an expired refresh token, opens anything.
   */
  async requestToken(interactive: boolean): Promise<string> {
    if (this.isSignedIn) return this.token!;
    this.pending ??= this.acquire(interactive).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async acquire(interactive: boolean): Promise<string> {
    if (this.refresh) {
      try {
        return await this.exchange({ grant_type: 'refresh_token', refresh_token: this.refresh });
      } catch (error) {
        // A refresh token can be revoked or simply expire. Falling through to
        // the popup is right when there is a gesture behind this call; without
        // one, the caller has to be told rather than have a window blocked.
        this.refresh = null;
        if (!interactive) throw error;
      }
    }
    if (!interactive) {
      throw new MicrosoftAuthError(
        'A sessão com a Microsoft expirou neste dispositivo. Toque em Sincronizar para reconectar.',
        'needs_gesture',
      );
    }
    return this.signIn();
  }

  private async signIn(): Promise<string> {
    const verifier = base64url(randomBytes(48));
    const state = `${MS_STATE_PREFIX}${base64url(randomBytes(12))}`;
    const redirectUri = window.location.origin;

    const url = new URL(`${AUTHORITY}/authorize`);
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_mode', 'query');
    url.searchParams.set('scope', MS_SCOPES.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', await challengeFor(verifier));
    url.searchParams.set('code_challenge_method', 'S256');

    const code = await waitForCode(url.toString(), state);
    return this.exchange({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    });
  }

  private async exchange(fields: Record<string, string>): Promise<string> {
    const body = new URLSearchParams({ client_id: this.clientId, scope: MS_SCOPES.join(' '), ...fields });
    let response: Response;
    try {
      response = await fetch(`${AUTHORITY}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new MicrosoftAuthError('Sem conexão com a Microsoft.', 'network');
    }

    const data = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !data.access_token) {
      throw new MicrosoftAuthError(
        data.error_description || data.error || `A Microsoft respondeu ${response.status}.`,
        data.error,
      );
    }

    this.token = data.access_token;
    // A minute of slack, so a request started just under the wire does not land
    // just over it.
    this.expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000;
    if (data.refresh_token) this.refresh = data.refresh_token;
    return this.token;
  }

  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  signOut(): void {
    this.invalidate();
    this.refresh = null;
  }

  async fetchAccount(): Promise<ProviderAccount> {
    const token = await this.requestToken(false);
    const response = await fetch(GRAPH_ME, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new MicrosoftAuthError('Não foi possível ler o perfil da conta Microsoft.');
    const data = (await response.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
    const email = data.mail ?? data.userPrincipalName ?? '';
    return { email, name: data.displayName ?? email ?? 'Conta Microsoft' };
  }
}

/**
 * Opens the popup and waits for the callback to report back.
 *
 * Two ways it can end badly and both are handled: the person closes the window,
 * which nothing would otherwise tell us, and the browser refuses to open it at
 * all — which is why this is only ever reached from a click.
 */
function waitForCode(authorizeUrl: string, state: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const popup = window.open(authorizeUrl, 'keeper-microsoft', 'width=520,height=680');
    if (!popup) {
      return reject(
        new MicrosoftAuthError('A janela da Microsoft foi bloqueada pelo navegador.', 'popup_blocked'),
      );
    }

    const finish = (fn: () => void) => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(closedTimer);
      window.clearTimeout(timeout);
      fn();
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; state?: string; code?: string; error?: string } | null;
      if (!data || data.type !== 'keeper-ms-auth' || data.state !== state) return;
      finish(() => {
        popup.close();
        if (data.code) resolve(data.code);
        else reject(new MicrosoftAuthError(data.error || 'Autenticação cancelada.', data.error));
      });
    };
    window.addEventListener('message', onMessage);

    const closedTimer = window.setInterval(() => {
      if (popup.closed) {
        finish(() => reject(new MicrosoftAuthError('Janela da Microsoft fechada antes de concluir.', 'popup_closed')));
      }
    }, 500);

    const timeout = window.setTimeout(() => {
      finish(() => {
        popup.close();
        reject(new MicrosoftAuthError('Tempo esgotado ao falar com a Microsoft.', 'timeout'));
      });
    }, 180_000);
  });
}

/**
 * Called from the popup, which is this same app booted at the redirect URI.
 *
 * Returns true when it handled a callback, so the caller stops before rendering
 * a whole vault into a window that is about to close.
 */
export function completeMicrosoftAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (!window.opener || !state?.startsWith(MS_STATE_PREFIX)) return false;

  const payload = {
    type: 'keeper-ms-auth',
    state,
    ...(params.get('code') ? { code: params.get('code') } : {}),
    ...(params.get('error') ? { error: params.get('error_description') ?? params.get('error') } : {}),
  };
  window.opener.postMessage(payload, window.location.origin);
  window.close();
  return true;
}
