/**
 * Google sign-in via Google Identity Services (GIS) token flow.
 *
 * The app is a pure static SPA: there is no backend and no client secret. GIS
 * hands us a short-lived access token that lives in memory only — it is never
 * written to storage, so closing the tab drops it.
 */

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/**
 * Lets the app create and reach files of its own anywhere in the Drive — and
 * nothing else: files it did not create stay invisible. Asked for only when the
 * user moves the vault into a folder they can see and share, never at sign-in,
 * because a vault that already syncs must not stop syncing over a permission
 * nobody has needed yet.
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const BASE_SCOPES = [
  DRIVE_APPDATA_SCOPE,
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];
export const SCOPES = BASE_SCOPES.join(' ');

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
      /** Loaded on demand by `picker.ts`, absent until a guest asks for it. */
      picker?: import('./picker').PickerApi;
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

/** Tells "this client may not ask for that" apart from "the user said no". */
function isScopeRefusal(error: unknown): boolean {
  if (!(error instanceof GoogleAuthError)) return false;
  if (error.code === 'popup_closed' || error.code === 'access_denied') return false;
  return error.code === 'invalid_scope' || /scope/i.test(error.message);
}

/** '' lets Google decide; 'consent' insists on the permissions screen. */
type PromptMode = '' | 'consent';

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
  /** Beyond the base set — asked for only once a feature needs them. */
  private extra = new Set<string>();
  private granted = new Set<string>();

  constructor(readonly clientId: string) {}

  get isSignedIn(): boolean {
    return !!this.token && Date.now() < this.expiresAt;
  }

  /** What Google actually handed over, which is not always what was asked. */
  hasScope(scope: string): boolean {
    return this.granted.has(scope);
  }

  /**
   * Adds a scope to every request from here on, without asking for it yet: a
   * device that was granted it in an earlier session renews silently with the
   * wider set instead of dropping back to the narrow one.
   */
  include(scope: string): void {
    if (this.extra.has(scope)) return;
    this.extra.add(scope);
    this.client = null;
  }

  /**
   * Asks for a scope now, with a consent screen. Resolves only if Google came
   * back with it — the user can untick a permission, and a silent "granted"
   * would leave the app writing where it cannot.
   */
  async requestScope(scope: string): Promise<void> {
    this.include(scope);
    this.invalidate();
    // The one place that really does want the consent screen: a permission the
    // person has not been asked for yet.
    await this.requestToken(true, undefined, 'consent');
    if (!this.hasScope(scope)) {
      throw new GoogleAuthError(
        'A permissão não foi concedida na tela do Google. Nada foi alterado no seu Drive.',
        'missing_scope',
      );
    }
  }

  private scopeString(): string {
    return [...BASE_SCOPES, ...this.extra].join(' ');
  }

  private async ensureClient(): Promise<TokenClient> {
    if (this.client) return this.client;
    await loadGisScript();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2) throw new GoogleAuthError('Google Identity Services indisponível.', 'unavailable');

    this.client = oauth2.initTokenClient({
      client_id: this.clientId,
      scope: this.scopeString(),
      callback: () => {}, // replaced per-request in `requestToken`
    });
    return this.client;
  }

  /**
   * Loads Google's script and builds the client ahead of time.
   *
   * Not an optimisation: browsers only allow a window to open from inside the
   * task that handled the click, and an `await` for a script that has not
   * downloaded yet breaks that chain. Preloading at boot means the click
   * handler reaches `requestAccessToken` with nothing between them.
   */
  async preload(): Promise<void> {
    await this.ensureClient().catch(() => undefined);
  }

  /**
   * @param interactive `false` means "use the token we already hold" and
   * nothing more.
   *
   * There is no such thing as a silent request here. GIS opens a window every
   * time — `prompt: ''` only means Google may close it again without asking
   * anything — and a window opened with no click behind it is blocked on the
   * desktop and, on a phone, can take the whole page to Google and leave it on
   * a blank callback with nothing to return to. So a non-interactive call never
   * touches GIS: it hands back what is in memory or fails, and whoever needed
   * it asks the user for a gesture.
   */
  async requestToken(interactive: boolean, hint?: string, prompt: PromptMode = ''): Promise<string> {
    if (this.isSignedIn) return this.token!;
    if (!interactive) {
      throw new GoogleAuthError(
        'A sessão com o Google expirou neste dispositivo. Toque em Sincronizar para reconectar.',
        'needs_gesture',
      );
    }
    this.pending ??= this.withNarrowFallback(interactive, hint, prompt).finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Google refuses the whole request when one scope in it is not configured for
   * the OAuth client. That must not be how a user discovers their vault stopped
   * syncing, so a request refused over a scope is retried with the base set and
   * the app carries on where it was — `hasScope` then reports the truth.
   *
   * Only over a scope: a closed popup or a refused consent is the user talking,
   * and answering it with a second popup would be worse than the failure.
   */
  private async withNarrowFallback(interactive: boolean, hint?: string, prompt: PromptMode = ''): Promise<string> {
    try {
      return await this.doRequest(interactive, hint, prompt);
    } catch (error) {
      if (this.extra.size === 0 || !isScopeRefusal(error)) throw error;
      this.extra.clear();
      this.client = null;
      return this.doRequest(interactive, hint, prompt);
    }
  }

  private async doRequest(interactive: boolean, hint?: string, prompt: PromptMode = ''): Promise<string> {
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
        this.granted = new Set((response.scope ?? '').split(' ').filter(Boolean));
        const granted = window.google?.accounts.oauth2.hasGrantedAllScopes?.(response, DRIVE_APPDATA_SCOPE);
        if (granted === false) {
          settle(() =>
            reject(
              new GoogleAuthError(
                'O acesso à pasta do app no Drive não foi concedido. Tente entrar de novo e marque a ' +
                  'caixa dessa permissão na tela do Google — o cofre não sincroniza sem ela.',
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
        /*
         * An empty prompt is not "no window" — it is "Google, show one only if
         * you must". With a live session and consent already given, the window
         * opens and closes itself. Forcing 'consent' here meant the full
         * account-and-permissions screen on every single renewal, which is how
         * a token that lasts an hour turned into a login every hour.
         */
        client.requestAccessToken({ prompt, ...(hint ? { hint } : {}) });
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
