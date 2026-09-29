import { describe, expect, it } from 'vitest';
import { assessSignOut, signOutPrompt } from './sign-out';

describe('sair deste aparelho', () => {
  it('é seguro quando a nuvem já tem tudo', () => {
    expect(assessSignOut({ hasVault: true, hasRemote: true, pending: false })).toEqual({ kind: 'none' });
  });

  it('recusa quando o cofre nunca saiu daqui, mesmo sem nada pendente', () => {
    // "Somente local": não há outra cópia em lado nenhum. Não é um aviso, é um não.
    expect(assessSignOut({ hasVault: true, hasRemote: false, pending: false }).kind).toBe('only-copy');
    expect(assessSignOut({ hasVault: true, hasRemote: false, pending: true }).kind).toBe('only-copy');
  });

  it('avisa das alterações que ainda não subiram, e diz porquê', () => {
    expect(
      assessSignOut({ hasVault: true, hasRemote: true, pending: true, reason: 'Sem conexão com o OneDrive.' }),
    ).toEqual({ kind: 'unsynced', reason: 'Sem conexão com o OneDrive.' });
  });

  it('um convidado sem cofre próprio não tem nada a perder aqui', () => {
    expect(assessSignOut({ hasVault: false, hasRemote: false, pending: true })).toEqual({ kind: 'none' });
  });
});

describe('o que a pessoa lê antes de apagar', () => {
  it('sair recusa apagar a única cópia, e diz como resolver', () => {
    const prompt = signOutPrompt({ kind: 'only-copy' }, 'sign-out', 'Google Drive');
    expect(prompt.kind).toBe('refuse');
    expect(prompt.message).toMatch(/nunca foi enviado/);
    expect(prompt.message).toMatch(/exporte um backup/);
    // Serve também na tela de desbloqueio, onde as Configurações só abrem com o cofre aberto.
    expect(prompt.message).toMatch(/abra o cofre/);
  });

  it('apagar deixa destruir a única cópia, mas não esconde que é para sempre', () => {
    const prompt = signOutPrompt({ kind: 'only-copy' }, 'wipe', 'Google Drive');
    expect(prompt.kind).toBe('confirm');
    expect(prompt.message).toMatch(/para sempre/);
    // A confirmação antiga prometia exatamente isto a quem não tinha cópia nenhuma.
    expect(prompt.message).not.toMatch(/continua no/);
  });

  it('com alterações por subir, diz que se perdem e porquê', () => {
    const prompt = signOutPrompt({ kind: 'unsynced', reason: 'Sem internet neste momento.' }, 'sign-out', 'OneDrive');
    expect(prompt.message).toMatch(/ainda não chegaram ao OneDrive/);
    expect(prompt.message).toMatch(/Sem internet neste momento\./);
    expect(prompt.message).toMatch(/se perdem/);
  });

  it('quando é seguro, diz onde o cofre continua e como voltar', () => {
    const prompt = signOutPrompt({ kind: 'none' }, 'sign-out', 'OneDrive');
    expect(prompt).toMatchObject({ kind: 'confirm' });
    expect(prompt.message).toMatch(/continua no OneDrive/);
    expect(prompt.message).toMatch(/senha mestra/);
  });
});
