/**
 * Google sign-in via Google Identity Services (GIS) token flow.
 *
 * The app is a pure static SPA: there is no backend and no client secret. GIS
 * hands us a short-lived access token that lives in memory only — it is never
 * written to storage, so closing the tab drops it.
 */

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const SCOPES = [
  DRIVE_APPDATA_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
].join(' ');

const GIS_SRC = 'https://accounts.google.com/gsi/client';
/** Refresh a little before the real expiry to avoid mid-request 401s. */
const EXPIRY_SKEW_MS = 60_000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; hint?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            prompt?: string;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done?: () => void): void;
          hasGrantedAllScopes?(token: TokenResponse, ...scopes: string[]): boolean;
        };
      };
    };
  }
}

export interface GoogleAccount {
  email: string;
  name: string;
  picture?: string;
}

export class GoogleAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      scriptPromise = null;
      reject(new GoogleAuthError('Não foi possível carregar o Google Identity Services (offline?).', 'script'));
    });
    if (!existing) document.head.append(script);
  });
  return scriptPromise;
}

/**
 * Holds the current access token and knows how to renew it. A renewal with
 * `prompt: ''` is silent whenever the user still has a Google session and has
 * already granted the scopes.
 */
export class GoogleAuth {
  private client: TokenClient | null = null;
  private token: string | null = null;
  private expiresAt = 0;
  private pending: Promise<string> | null = null;

  constructor(readonly clientId: string) {}

  get isSignedIn(): boolean {
    return !!this.token && Date.now() < this.expiresAt;
  }

  private async ensureClient(): Promise<TokenClient> {
    if (this.client) return this.client;
    await loadGisScript();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) throw new GoogleAuthError('Google Identity Services indisponível.', 'unavailable');

    this.client = oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPES,
      callback: () => {}, // replaced per-request in `requestToken`
    });
    return this.client;
  }

  /**
   * @param interactive `false` attempts a silent renewal and fails fast when
   * consent or a session is required.
   */
  async requestToken(interactive: boolean, hint?: string): Promise<string> {
    if (this.isSignedIn) return this.token!;
    this.pending ??= this.doRequest(interactive, hint).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async doRequest(interactive: boolean, hint?: string): Promise<string> {
    const client = await this.ensureClient();
    return new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new GoogleAuthError('Tempo esgotado ao falar com o Google.', 'timeout'));
      }, interactive ? 180_000 : 20_000);

      const settle = (fn: () => void) => {
        window.clearTimeout(timeout);
        fn();
      };

      // GIS keeps a single callback per client, so rebind it for this request.
      (client as unknown as { callback: (r: TokenResponse) => void }).callback = (response) => {
        if (response.error || !response.access_token) {
          settle(() =>
            reject(
              new GoogleAuthError(
                response.error_description || response.error || 'Falha ao obter o token de acesso.',
                response.error,
              ),
            ),
          );
          return;
        }
        const granted = window.google?.accounts.oauth2.hasGrantedAllScopes?.(response, DRIVE_APPDATA_SCOPE);
        if (granted === false) {
          settle(() =>
            reject(
              new GoogleAuthError(
                'A permissão de acesso ao Drive (pasta do app) não foi concedida.',
                'missing_scope',
              ),
            ),
          );
          return;
        }
        this.token = response.access_token;
        this.expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000 - EXPIRY_SKEW_MS;
        settle(() => resolve(this.token!));
      };

      (client as unknown as { error_callback: (e: { type?: string; message?: string }) => void }).error_callback = (
        error,
      ) => {
        settle(() =>
          reject(
            new GoogleAuthError(
              error.type === 'popup_closed'
                ? 'Janela do Google fechada antes de concluir o login.'
                : error.message || 'Falha na autenticação com o Google.',
              error.type,
            ),
          ),
        );
      };

      try {
        client.requestAccessToken({ prompt: interactive ? 'consent' : '', ...(hint ? { hint } : {}) });
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new GoogleAuthError(String(error))));
      }
    });
  }

  /** Force a renewal on the next call — used after a 401 from Drive. */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  async signOut(): Promise<void> {
    const token = this.token;
    this.invalidate();
    if (!token) return;
    await new Promise<void>((resolve) => {
      try {
        window.google?.accounts.oauth2.revoke(token, () => resolve());
        window.setTimeout(resolve, 3000);
      } catch {
        resolve();
      }
    });
  }

  async fetchAccount(): Promise<GoogleAccount> {
    const token = await this.requestToken(false);
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new GoogleAuthError('Não foi possível ler o perfil da conta Google.');
    const data = (await response.json()) as { email?: string; name?: string; picture?: string };
    return {
      email: data.email ?? '',
      name: data.name ?? data.email ?? 'Conta Google',
      ...(data.picture ? { picture: data.picture } : {}),
    };
  }
}
