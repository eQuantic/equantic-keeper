import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MS_SCOPES,
  MS_STATE_PREFIX,
  MicrosoftAuth,
  MicrosoftAuthError,
  completeMicrosoftAuthCallback,
} from './ms-auth';

const ORIGIN = 'https://keeper.equantic.tech';

interface Posted {
  data: unknown;
  targetOrigin: string;
}

/**
 * A window, small enough to reason about.
 *
 * The tests run under node, where there is none — which turns out to be the
 * point: a fake one makes the popup handshake observable step by step, and lets
 * a test assert things a real browser would hide, such as which origin a
 * message was posted to.
 */
function stubWindow(over: Record<string, unknown> = {}) {
  const listeners = new Set<(event: { origin: string; data: unknown }) => void>();
  const opened: string[] = [];
  const posted: Posted[] = [];
  const popup = { closed: false, close: () => undefined };
  let closed = false;

  const win = {
    location: { origin: ORIGIN, search: '' },
    open: (url: string) => {
      opened.push(url);
      return popup;
    },
    addEventListener: (type: string, fn: (event: { origin: string; data: unknown }) => void) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (_type: string, fn: (event: { origin: string; data: unknown }) => void) => {
      listeners.delete(fn);
    },
    setInterval: (fn: () => void, ms: number) => globalThis.setInterval(fn, ms),
    clearInterval: (id: number) => globalThis.clearInterval(id),
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
    close: () => {
      closed = true;
    },
    ...over,
  };
  vi.stubGlobal('window', win);

  return {
    opened,
    posted,
    popup,
    get closed() {
      return closed;
    },
    deliver(data: unknown, origin = ORIGIN) {
      for (const fn of [...listeners]) fn({ origin, data });
    },
  };
}

/**
 * Waits until the popup is actually open, rather than for a fixed tick.
 *
 * The challenge is a real SHA-256 digest, which node settles on its threadpool
 * whenever it settles — a tick or two is usually enough and sometimes is not.
 * Polling for the effect makes this deterministic, and says so out loud when
 * the window never opens instead of failing later as an invalid URL.
 */
async function untilOpen(win: ReturnType<typeof stubWindow>, fakeClock = false): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (win.opened.length > 0) return;
    if (fakeClock) await vi.advanceTimersByTimeAsync(1);
    else await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('a janela da Microsoft nunca foi aberta');
}

function stubToken(reply: () => { status?: number; body?: unknown } = () => ({})): URLSearchParams[] {
  const posts: URLSearchParams[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit = {}) => {
      posts.push(new URLSearchParams(String(init.body)));
      const { status = 200, body = { access_token: 'at-1', expires_in: 3600 } } = reply();
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return posts;
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

async function digestOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Runs a whole popup sign-in, answering the callback with `code-1`. */
async function signIn(auth: MicrosoftAuth, win: ReturnType<typeof stubWindow>): Promise<string> {
  const pending = auth.requestToken(true);
  await untilOpen(win);
  win.deliver({ type: 'keeper-ms-auth', state: paramsOf(win.opened[0]!).get('state'), code: 'code-1' });
  return pending;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('o pedido que vai para a Microsoft', () => {
  it('leva o hash do verificador, e nunca o verificador', async () => {
    const win = stubWindow();
    const posts = stubToken();
    await signIn(new MicrosoftAuth('client-1'), win);

    const authorize = paramsOf(win.opened[0]!);
    expect(authorize.get('code_challenge_method')).toBe('S256');
    // O verificador é o segredo que fica neste separador. Se ele viajasse, o
    // PKCE não estaria a proteger de nada.
    const verifier = posts[0]!.get('code_verifier')!;
    expect(win.opened[0]).not.toContain(verifier);
    expect(authorize.get('code_challenge')).toBe(await digestOf(verifier));
  });

  it('gera um verificador diferente a cada vez', async () => {
    const first = stubToken();
    await signIn(new MicrosoftAuth('client-1'), stubWindow());
    vi.unstubAllGlobals();
    const second = stubToken();
    await signIn(new MicrosoftAuth('client-1'), stubWindow());

    expect(first[0]!.get('code_verifier')).not.toBe(second[0]!.get('code_verifier'));
  });

  it('pede apenas a pasta do próprio app, e o suficiente para renovar', async () => {
    const win = stubWindow();
    stubToken();
    await signIn(new MicrosoftAuth('client-1'), win);

    const scope = paramsOf(win.opened[0]!).get('scope')!.split(' ');
    expect(scope).toContain('Files.ReadWrite.AppFolder');
    expect(scope).toContain('offline_access');
    // Nada aqui pode chegar ao resto do OneDrive de uma pessoa.
    expect(scope.some((entry) => /^Files\.(ReadWrite|Read)(\.All)?$/.test(entry))).toBe(false);
    expect(MS_SCOPES).toEqual(scope);
  });

  it('volta para a própria origem, sem segredo nenhum na URL', async () => {
    const win = stubWindow();
    stubToken();
    await signIn(new MicrosoftAuth('client-1'), win);

    const authorize = paramsOf(win.opened[0]!);
    expect(authorize.get('redirect_uri')).toBe(ORIGIN);
    expect(authorize.get('state')!.startsWith(MS_STATE_PREFIX)).toBe(true);
    // Um site estático não tem onde guardar um segredo, e não usa nenhum.
    expect(authorize.get('client_secret')).toBeNull();
    expect(win.opened[0]).toContain('login.microsoftonline.com/common/');
  });
});

describe('renovar sem incomodar ninguém', () => {
  it('não abre janela nenhuma quando há como renovar em silêncio', async () => {
    const win = stubWindow();
    const posts = stubToken(() => ({ body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 0 } }));
    const auth = new MicrosoftAuth('client-1');
    await signIn(auth, win);

    expect(auth.canRenew).toBe(true);
    await auth.requestToken(false);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.get('grant_type')).toBe('refresh_token');
    // Uma janela por sessão. A segunda seria a que assusta.
    expect(win.opened).toHaveLength(1);
  });

  it('recusa em vez de abrir uma janela sem um toque por trás', async () => {
    const win = stubWindow();
    stubToken();
    const auth = new MicrosoftAuth('client-1');

    await expect(auth.requestToken(false)).rejects.toMatchObject({ code: 'needs_gesture' });
    expect(win.opened).toHaveLength(0);
  });

  it('dois pedidos ao mesmo tempo fazem uma troca só', async () => {
    const win = stubWindow();
    const posts = stubToken(() => ({ body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 0 } }));
    const auth = new MicrosoftAuth('client-1');
    await signIn(auth, win);

    const [a, b] = await Promise.all([auth.requestToken(false), auth.requestToken(false)]);
    expect(a).toBe(b);
    expect(posts).toHaveLength(2);
  });

  it('sair apaga o que permitia voltar sem perguntar', async () => {
    const win = stubWindow();
    stubToken(() => ({ body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 0 } }));
    const auth = new MicrosoftAuth('client-1');
    await signIn(auth, win);

    auth.signOut();
    expect(auth.canRenew).toBe(false);
    await expect(auth.requestToken(false)).rejects.toMatchObject({ code: 'needs_gesture' });
  });

  it('um refresh recusado sem toque é dito, e não vira uma janela', async () => {
    const win = stubWindow();
    let first = true;
    stubToken(() => {
      if (first) {
        first = false;
        return { body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 0 } };
      }
      return { status: 400, body: { error: 'invalid_grant' } };
    });
    const auth = new MicrosoftAuth('client-1');
    await signIn(auth, win);

    await expect(auth.requestToken(false)).rejects.toBeInstanceOf(MicrosoftAuthError);
    expect(win.opened).toHaveLength(1);
  });
});

describe('quando a janela corre mal', () => {
  it('diz que foi bloqueada, em vez de esperar para sempre', async () => {
    stubWindow({ open: () => null });
    stubToken();
    await expect(new MicrosoftAuth('client-1').requestToken(true)).rejects.toMatchObject({
      code: 'popup_blocked',
    });
  });

  it('percebe quando a pessoa fecha a janela', async () => {
    vi.useFakeTimers();
    const win = stubWindow();
    stubToken();
    // A expectativa fica ligada antes de o relógio andar: uma rejeição sem
    // ninguém à escuta é reportada como erro solto e esconde a falha real.
    const settled = expect(new MicrosoftAuth('client-1').requestToken(true)).rejects.toMatchObject({
      code: 'popup_closed',
    });
    await untilOpen(win, true);

    win.popup.closed = true;
    await vi.advanceTimersByTimeAsync(600);
    await settled;
  });

  it('ignora uma mensagem de outra origem', async () => {
    vi.useFakeTimers();
    const win = stubWindow();
    stubToken();
    const settled = expect(new MicrosoftAuth('client-1').requestToken(true)).rejects.toMatchObject({
      code: 'popup_closed',
    });
    await untilOpen(win, true);

    const state = paramsOf(win.opened[0]!).get('state');
    win.deliver({ type: 'keeper-ms-auth', state, code: 'roubado' }, 'https://exemplo-mau.test');
    // Nada aconteceu: continua à espera até fecharem a janela.
    win.popup.closed = true;
    await vi.advanceTimersByTimeAsync(600);
    await settled;
  });

  it('ignora uma mensagem com outro state', async () => {
    vi.useFakeTimers();
    const win = stubWindow();
    stubToken();
    const settled = expect(new MicrosoftAuth('client-1').requestToken(true)).rejects.toMatchObject({
      code: 'popup_closed',
    });
    await untilOpen(win, true);

    win.deliver({ type: 'keeper-ms-auth', state: `${MS_STATE_PREFIX}outro`, code: 'de-outro-pedido' });
    win.popup.closed = true;
    await vi.advanceTimersByTimeAsync(600);
    await settled;
  });

  it('mostra o que a Microsoft explicou, e não só o número', async () => {
    const win = stubWindow();
    stubToken(() => ({
      status: 400,
      body: { error: 'invalid_grant', error_description: 'O código expirou.' },
    }));
    await expect(signIn(new MicrosoftAuth('client-1'), win)).rejects.toThrow('O código expirou.');
  });
});

describe('a volta, dentro da janela', () => {
  it('não faz nada numa aba normal', () => {
    stubWindow({ location: { origin: ORIGIN, search: '?code=abc' } });
    expect(completeMicrosoftAuthCallback()).toBe(false);
  });

  it('deixa passar o que não é nosso', () => {
    stubWindow({
      location: { origin: ORIGIN, search: '?state=algo-do-google&code=abc' },
      opener: { postMessage: () => undefined },
    });
    expect(completeMicrosoftAuthCallback()).toBe(false);
  });

  it('entrega o código a quem abriu, só para a nossa origem', () => {
    const posted: Posted[] = [];
    const win = stubWindow({
      location: { origin: ORIGIN, search: `?state=${MS_STATE_PREFIX}xyz&code=abc123` },
      opener: {
        postMessage: (data: unknown, targetOrigin: string) => posted.push({ data, targetOrigin }),
      },
    });

    expect(completeMicrosoftAuthCallback()).toBe(true);
    expect(posted[0]!.data).toMatchObject({ type: 'keeper-ms-auth', code: 'abc123' });
    // Um "*" aqui daria o código a qualquer página que estivesse à escuta.
    expect(posted[0]!.targetOrigin).toBe(ORIGIN);
    expect(win.closed).toBe(true);
  });

  it('leva também a recusa, para o pedido não ficar pendurado', () => {
    const posted: Posted[] = [];
    stubWindow({
      location: {
        origin: ORIGIN,
        search: `?state=${MS_STATE_PREFIX}xyz&error=access_denied&error_description=Cancelado`,
      },
      opener: {
        postMessage: (data: unknown, targetOrigin: string) => posted.push({ data, targetOrigin }),
      },
    });

    expect(completeMicrosoftAuthCallback()).toBe(true);
    expect(posted[0]!.data).toMatchObject({ error: 'Cancelado' });
    expect(posted[0]!.data).not.toHaveProperty('code');
  });
});

describe('a conta', () => {
  it('prefere o e-mail, e cai no nome de utilizador quando não há', async () => {
    const win = stubWindow();
    let profile: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (String(url).includes('/me')) return new Response(JSON.stringify(profile));
        void init;
        return new Response(JSON.stringify({ access_token: 'at-1', expires_in: 3600 }));
      }),
    );
    const auth = new MicrosoftAuth('client-1');
    await signIn(auth, win);

    profile = { userPrincipalName: 'alguem@outlook.com', displayName: 'Alguém' };
    expect(await auth.fetchAccount()).toEqual({ email: 'alguem@outlook.com', name: 'Alguém' });

    profile = { mail: 'principal@outlook.com', userPrincipalName: 'outro@outlook.com', displayName: 'Alguém' };
    expect((await auth.fetchAccount()).email).toBe('principal@outlook.com');
  });
});
