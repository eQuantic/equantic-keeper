import { afterEach, describe, expect, it, vi } from 'vitest';
import { OneDriveClient, OneDriveError } from './onedrive';
import type { MicrosoftAuth } from './ms-auth';
import { CIPHER, KDF_ALGO } from './crypto';
import { VAULT_FORMAT, VAULT_VERSION, type VaultFile } from './vault';

/**
 * Graph, faked at the network boundary.
 *
 * The client is nothing but a translation from `VaultStorage` into HTTP, so what
 * is worth asserting is the HTTP: which method, which address, which body. A
 * double that answers canned JSON puts all three under a test without an
 * account, which is the only way this file could exist at all.
 */
interface Call {
  url: string;
  method: string;
  body?: unknown;
  headers: Record<string, string>;
}

type Route = [RegExp, () => { status?: number; body?: unknown }];

function graph(routes: Route[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const headers: Record<string, string> = {};
      new Headers(init.headers).forEach((value, key) => {
        headers[key] = value;
      });
      calls.push({
        url: String(input),
        method: init.method ?? 'GET',
        headers,
        ...(typeof init.body === 'string' ? { body: JSON.parse(init.body) as unknown } : {}),
      });

      const route = routes.find(([pattern]) => pattern.test(String(input)));
      const { status = 200, body = {} } = route ? route[1]() : { status: 404, body: {} };
      return new Response(JSON.stringify(body), { status });
    }),
  );
  return calls;
}

/** Every call gets a different token, so a renewal is visible in the headers. */
let issued = 0;
function auth(): MicrosoftAuth {
  return {
    requestToken: async () => `token-${++issued}`,
    invalidate: () => undefined,
  } as unknown as MicrosoftAuth;
}

const item = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  name: 'vault.keeper.json',
  size: 128,
  lastModifiedDateTime: '2026-09-09T10:00:00Z',
  cTag: 'ctag-1',
  ...over,
});

const vault: VaultFile = {
  format: VAULT_FORMAT,
  version: VAULT_VERSION,
  kdf: { algo: KDF_ALGO, iterations: 720_000, salt: 'c2FsdA==' },
  cipher: CIPHER,
  verifier: 'dg==',
  iv: 'aXY=',
  data: 'ZGF0YQ==',
  updatedAt: '2026-09-09T10:00:00Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('onde o cliente escreve', () => {
  it('usa a pasta do app por padrão e a pasta escolhida quando movido', async () => {
    const calls = graph([[/.*/, () => ({ body: item() })]]);
    const client = new OneDriveClient(auth());

    await client.create('vault.keeper.json', vault);
    expect(calls[0]!.url).toContain('/me/drive/special/approot:/vault.keeper.json:/content');

    await client.withSpace({ kind: 'folder', id: 'pasta-1' }).create('vault.keeper.json', vault);
    expect(calls[1]!.url).toContain('/me/drive/items/pasta-1:/vault.keeper.json:/content');
    // E o cliente de onde ele saiu não se move junto.
    expect(client.space).toEqual({ kind: 'appdata' });
  });

  it('escreve pelo caminho, que cria e substitui na mesma chamada', async () => {
    const calls = graph([[/.*/, () => ({ body: item() })]]);
    await new OneDriveClient(auth()).create('shares.keeper.json', { format: 'x' });

    expect(calls[0]!.method).toBe('PUT');
    expect(calls[0]!.body).toEqual({ format: 'x' });
  });
});

describe('leitura', () => {
  it('segue a paginação até o fim', async () => {
    graph([
      [
        /children/,
        () => ({
          body: {
            value: [item({ id: 'a' })],
            '@odata.nextLink': 'https://graph.microsoft.com/v1.0/pagina-2',
          },
        }),
      ],
      [/pagina-2/, () => ({ body: { value: [item({ id: 'b' })] } })],
    ]);

    const files = await new OneDriveClient(auth()).listAll();
    expect(files.map((file) => file.id)).toEqual(['a', 'b']);
  });

  it('traduz um nome exato e um prefixo, que é tudo que lhe pedem', async () => {
    graph([
      [
        /children/,
        () => ({
          body: {
            value: [
              item({ id: 'v', name: 'vault.keeper.json' }),
              item({ id: 'b1', name: 'backup-2026-09-01.json' }),
              item({ id: 'b2', name: 'backup-2026-09-02.json' }),
            ],
          },
        }),
      ],
    ]);
    const client = new OneDriveClient(auth());

    expect((await client.listFiles(`name = 'vault.keeper.json'`)).map((f) => f.id)).toEqual(['v']);
    expect((await client.listFiles(`name contains 'backup-'`)).map((f) => f.id)).toEqual(['b1', 'b2']);
    expect((await client.findVault())?.id).toBe('v');
  });

  it('usa o cTag como revisão, que muda com o conteúdo e não com um rename', async () => {
    graph([[/items\/i1/, () => ({ body: item({ cTag: 'ctag-9', eTag: 'etag-outro' }) })]]);
    const meta = await new OneDriveClient(auth()).getMeta('i1');
    expect(meta.headRevisionId).toBe('ctag-9');
  });

  it('devolve o cofre quando o arquivo é um', async () => {
    graph([
      [/children/, () => ({ body: { value: [item({ id: 'v' })] } })],
      [/content/, () => ({ body: vault })],
    ]);
    const remote = await new OneDriveClient(auth()).fetchVault();
    expect(remote?.file.data).toBe('ZGF0YQ==');
  });

  it('recusa um arquivo que não é um cofre', async () => {
    graph([[/content/, () => ({ body: { qualquer: 'coisa' } })]]);
    await expect(new OneDriveClient(auth()).download('i1')).rejects.toBeInstanceOf(OneDriveError);
  });
});

describe('a pasta visível', () => {
  it('devolve nulo quando ela não existe, em vez de estourar', async () => {
    graph([[/root:/, () => ({ status: 404, body: { error: { message: 'itemNotFound' } } })]]);
    await expect(new OneDriveClient(auth()).findFolder()).resolves.toBeNull();
  });

  it('cria quando falta e reaproveita quando já está lá', async () => {
    let exists = false;
    const calls = graph([
      [
        /root:\//,
        () => (exists ? { body: item({ id: 'pasta', name: 'eQuantic Keeper' }) } : { status: 404, body: {} }),
      ],
      [
        /root\/children/,
        () => {
          exists = true;
          return { body: item({ id: 'pasta', name: 'eQuantic Keeper' }) };
        },
      ],
    ]);
    const client = new OneDriveClient(auth());

    expect((await client.ensureFolder()).id).toBe('pasta');
    expect((await client.ensureFolder()).id).toBe('pasta');
    // A segunda chamada encontrou o que a primeira criou, e não criou de novo.
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('se dois aparelhos criarem ao mesmo tempo, fica uma pasta só', async () => {
    let raced = false;
    graph([
      [/root:\//, () => (raced ? { body: item({ id: 'pasta-do-outro' }) } : { status: 404, body: {} })],
      [
        /root\/children/,
        () => {
          // O outro aparelho ganhou a corrida entre a busca e a criação.
          raced = true;
          return { status: 409, body: { error: { message: 'nameAlreadyExists' } } };
        },
      ],
    ]);

    expect((await new OneDriveClient(auth()).ensureFolder()).id).toBe('pasta-do-outro');
  });
});

describe('backups', () => {
  it('não faz um novo se o último ainda é do dia', async () => {
    const calls = graph([
      [
        /children/,
        () => ({
          body: {
            value: [item({ id: 'b', name: 'backup-agora.json', lastModifiedDateTime: new Date().toISOString() })],
          },
        }),
      ],
    ]);

    await new OneDriveClient(auth()).rotateBackups(vault);
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('faz um novo e apaga os que passaram do limite', async () => {
    const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const calls = graph([
      [
        /children/,
        () => ({
          body: {
            value: Array.from({ length: 6 }, (_, index) =>
              item({ id: `b${index}`, name: `backup-${index}.json`, lastModifiedDateTime: days(index + 2) }),
            ),
          },
        }),
      ],
      [/.*/, () => ({ body: item() })],
    ]);

    await new OneDriveClient(auth()).rotateBackups(vault);
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    // Cinco ficam (o novo mais quatro dos antigos), os outros dois saem.
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2);
  });
});

describe('autenticação', () => {
  it('manda o token em cada chamada', async () => {
    const calls = graph([[/.*/, () => ({ body: item() })]]);
    await new OneDriveClient(auth()).getMeta('i1');
    expect(calls[0]!.headers['authorization']).toMatch(/^Bearer token-/);
  });

  it('tenta de novo uma vez com um token novo depois de um 401', async () => {
    let first = true;
    const calls = graph([
      [
        /.*/,
        () => {
          if (!first) return { body: item() };
          first = false;
          return { status: 401, body: { error: { message: 'expired' } } };
        },
      ],
    ]);

    await expect(new OneDriveClient(auth()).getMeta('i1')).resolves.toMatchObject({ id: 'i1' });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers['authorization']).not.toBe(calls[1]!.headers['authorization']);
  });

  it('não entra em ciclo se o segundo token também for recusado', async () => {
    const calls = graph([[/.*/, () => ({ status: 401, body: { error: { message: 'expired' } } })]]);
    await expect(new OneDriveClient(auth()).getMeta('i1')).rejects.toBeInstanceOf(OneDriveError);
    expect(calls).toHaveLength(2);
  });

  it('explica um 403 em vez de repetir o que o Graph disse', async () => {
    graph([[/.*/, () => ({ status: 403, body: { error: { message: 'accessDenied' } } })]]);
    await expect(new OneDriveClient(auth()).getMeta('i1')).rejects.toThrow(/Permissão insuficiente/);
  });
});

describe('o contrato do provedor', () => {
  it('declara o que não faz, em vez de falhar quando pedirem', () => {
    const client = new OneDriveClient(auth());
    expect(client.label).toBe('OneDrive');
    // A partilha não está implementada aqui, e as telas leem isto para não a oferecer.
    expect(client.shares).toBe(false);
  });
});
