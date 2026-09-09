import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider, setProvider } from './storage';

/**
 * A localStorage, because the suite runs under node and there is none.
 *
 * Kept deliberately dumb: the point of these tests is which key holds what, and
 * what happens when it holds something unexpected — which is the situation every
 * install that predates OneDrive is in.
 */
function stubStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
  return store;
}

beforeEach(() => {
  stubStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('qual serviço este dispositivo usa', () => {
  it('é o Google quando nunca ninguém escolheu', () => {
    // Todo install anterior ao OneDrive está exatamente aqui.
    expect(getProvider()).toBe('google');
  });

  it('guarda a escolha e devolve-a', () => {
    setProvider('microsoft');
    expect(getProvider()).toBe('microsoft');
  });

  it('voltar ao Google apaga a chave, em vez de gravar o padrão', () => {
    const store = stubStorage();
    setProvider('microsoft');
    expect(store.has('keeper.storage.provider')).toBe(true);

    setProvider('google');
    // Nada gravado significa que uma versão futura pode mudar de padrão sem
    // ter de reinterpretar o que já está no disco de toda a gente.
    expect(store.has('keeper.storage.provider')).toBe(false);
    expect(getProvider()).toBe('google');
  });

  it('um valor que não conhecemos cai no Google, e não em coisa nenhuma', () => {
    stubStorage({ 'keeper.storage.provider': 'dropbox' });
    expect(getProvider()).toBe('google');
  });

  it('sobrevive a um localStorage que recusa tudo', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    });
    // Navegação privada em alguns browsers é literalmente isto.
    expect(getProvider()).toBe('google');
    expect(() => setProvider('microsoft')).not.toThrow();
  });
});
