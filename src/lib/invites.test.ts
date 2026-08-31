import { describe, expect, it } from 'vitest';
import { MIN_ITERATIONS, generateContentKey } from './crypto';
import {
  InviteCodeError,
  createIdentity,
  emptyShares,
  findOwnShare,
  fingerprint,
  inviteCode,
  isSharesFile,
  buildInviteLink,
  readInviteCode,
  readInviteLink,
  rewrapShare,
  unwrapWithSecret,
  wrapForLink,
  unwrapWithIdentity,
  wrapForRecipient,
} from './invites';
import { createVault, emptyPayload, openVaultWithDataKey, resealVault, sealVault, unlockVault } from './vault';
import { createItem, type VaultItem } from './model';

const iterations = MIN_ITERATIONS;
const PASSWORD = 'senha-mestra-do-dono';

function itemWith(name: string): VaultItem {
  return { ...createItem('note'), name };
}

describe('código de convite', () => {
  it('vai e volta como texto', async () => {
    const identity = await createIdentity();
    const code = await inviteCode(identity);

    expect(code.startsWith('KEEPER1-')).toBe(true);
    const back = await readInviteCode(code);
    expect(await fingerprint(back)).toBe(await fingerprint(identity.publicKey));
  });

  it('sobrevive ao que os apps de mensagem fazem com ele', async () => {
    const identity = await createIdentity();
    const code = await inviteCode(identity);
    // Quebrado em linhas e com espaços, como chega colado do WhatsApp.
    const mangled = `  ${code.slice(0, 30)}\n${code.slice(30, 60)} \n ${code.slice(60)}  `;

    const back = await readInviteCode(mangled);
    expect(await fingerprint(back)).toBe(await fingerprint(identity.publicKey));
  });

  it('recusa um código truncado como erro de cópia, não como falha de cripto', async () => {
    const code = await inviteCode(await createIdentity());
    const truncated = `${code.slice(0, code.length - 12)}-${code.slice(-6)}`;

    await expect(readInviteCode(truncated)).rejects.toBeInstanceOf(InviteCodeError);
  });

  it('recusa um checksum que não confere', async () => {
    const code = await inviteCode(await createIdentity());
    const wrong = `${code.slice(0, code.lastIndexOf('-'))}-AAAAAA`;

    await expect(readInviteCode(wrong)).rejects.toThrow(/não confere|pedaço/i);
  });

  it('recusa qualquer outro texto', async () => {
    await expect(readInviteCode('bom dia')).rejects.toBeInstanceOf(InviteCodeError);
    await expect(readInviteCode('')).rejects.toBeInstanceOf(InviteCodeError);
  });

  it('o checksum não é um pedaço da confirmação', async () => {
    const identity = await createIdentity();
    const code = await inviteCode(identity);
    const given = code.slice(code.lastIndexOf('-') + 1);
    const print = await fingerprint(identity.publicKey);

    // Os dois aparecem lado a lado na tela; se um fosse prefixo do outro,
    // pareceriam a mesma coisa escrita com erro.
    expect(given).not.toBe(print.slice(0, given.length).toUpperCase());
  });

  it('a chave privada não é exportável', async () => {
    const identity = await createIdentity();
    expect(identity.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', identity.privateKey)).rejects.toThrow();
  });
});

describe('partilhar a chave do cofre', () => {
  it('o convidado abre o cofre sem conhecer a senha mestra', async () => {
    const payload = { ...emptyPayload(), items: [itemWith('Passaporte')] };
    const { file, keys } = await createVault(PASSWORD, payload, iterations);

    const maria = await createIdentity();
    const record = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'reader' });
    const dataKey = await unwrapWithIdentity(record, maria);

    const opened = await openVaultWithDataKey(file, dataKey);
    expect(opened.items.map((item) => item.name)).toEqual(['Passaporte']);
  });

  it('outra pessoa não abre o registo alheio', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();
    const joao = await createIdentity();

    const record = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'reader' });

    await expect(unwrapWithIdentity(record, joao)).rejects.toThrow();
  });

  it('um registo adulterado não abre', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();
    const record = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'reader' });

    // Mover o embrulho para outro registo: é o que um atacante com acesso de
    // escrita à pasta tentaria, para dar a si próprio a chave de outra pessoa.
    await expect(unwrapWithIdentity({ ...record, id: crypto.randomUUID() }, maria)).rejects.toThrow();
    await expect(unwrapWithIdentity({ ...record, fingerprint: 'outro' }, maria)).rejects.toThrow();
  });

  it('cada partilha é um embrulho diferente da mesma chave', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();

    const first = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'reader' });
    const second = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'writer' });

    expect(first.key).not.toBe(second.key);
    expect(first.ephemeral).not.toBe(second.ephemeral);
    // E ambos abrem: partilhar de novo não invalida o convite anterior.
    await expect(unwrapWithIdentity(first, maria)).resolves.toBeDefined();
    await expect(unwrapWithIdentity(second, maria)).resolves.toBeDefined();
  });

  it('trocar a senha mestra não corta quem já tem acesso', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();
    const record = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'reader' });

    // O dono troca a senha: o envelope do cabeçalho muda, a chave de dados não.
    const { file: after } = await createVault('outra-senha-mestra', emptyPayload(), iterations);
    const resealed = await resealVault(after, keys.data, { ...emptyPayload(), items: [itemWith('Novo')] });

    const dataKey = await unwrapWithIdentity(record, maria);
    const opened = await openVaultWithDataKey(resealed, dataKey);
    expect(opened.items.map((item) => item.name)).toEqual(['Novo']);
  });
});

describe('o convidado escrevendo de volta', () => {
  it('re-sela o cofre sem tocar no cabeçalho do dono', async () => {
    const { file, keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();
    const record = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'writer' });
    const dataKey = await unwrapWithIdentity(record, maria);

    const edited = await resealVault(file, dataKey, { ...emptyPayload(), items: [itemWith('Escrito pela Maria')] });

    // O que é do dono continua do dono, byte a byte.
    expect(edited.verifier).toBe(file.verifier);
    expect(edited.dataKey).toEqual(file.dataKey);
    expect(edited.kdf).toEqual(file.kdf);
    expect(edited.data).not.toBe(file.data);

    // E o dono continua a abrir com a senha dele o que ela escreveu.
    const owner = await unlockVault(edited, PASSWORD);
    expect(owner.payload.items.map((item) => item.name)).toEqual(['Escrito pela Maria']);
  });

  it('a chave que o convidado recebe não pode ser exportada', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();
    const record = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'writer' });

    const dataKey = await unwrapWithIdentity(record, maria);
    expect(dataKey.extractable).toBe(false);
  });
});

describe('rodar a chave sem cortar quem fica', () => {
  it('reembrulha o registo para a mesma pessoa com a chave nova', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();
    const before = await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'writer' });

    const nova = await generateContentKey();
    const after = await rewrapShare(before, nova);

    // A identidade do registo é a mesma: é a mesma partilha, outra chave.
    expect(after.id).toBe(before.id);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.label).toBe('Maria');
    expect(after.role).toBe('writer');
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.key).not.toBe(before.key);

    const opened = await unwrapWithIdentity(after, maria);
    const sealed = await sealVault({ derived: keys.derived, data: nova }, {
      ...emptyPayload(),
      items: [itemWith('Depois da rotação')],
    });
    expect((await openVaultWithDataKey(sealed, opened)).items.map((item) => item.name)).toEqual([
      'Depois da rotação',
    ]);
  });

  it('o registo antigo não abre o cofre novo', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const joao = await createIdentity();
    const old = await wrapForRecipient(keys.data, joao.publicKey, { label: 'João', role: 'reader' });

    const nova = await generateContentKey();
    const sealed = await sealVault({ derived: keys.derived, data: nova }, emptyPayload());

    // Ele ainda abre o registo dele — o que ele já tinha, tinha. Mas a chave
    // que sai dali não abre mais o cofre, que é o ponto de revogar.
    const stale = await unwrapWithIdentity(old, joao);
    await expect(openVaultWithDataKey(sealed, stale)).rejects.toThrow();
  });
});

describe('arquivo de partilhas', () => {
  it('reconhece o próprio registo entre vários', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const maria = await createIdentity();
    const joao = await createIdentity();

    const file = {
      ...emptyShares(),
      shares: [
        await wrapForRecipient(keys.data, joao.publicKey, { label: 'João', role: 'reader' }),
        await wrapForRecipient(keys.data, maria.publicKey, { label: 'Maria', role: 'writer' }),
      ],
    };

    expect((await findOwnShare(file, maria))?.label).toBe('Maria');
    expect((await findOwnShare(file, joao))?.label).toBe('João');
    expect(await findOwnShare(file, await createIdentity())).toBeNull();
  });

  it('reconhece o formato do arquivo', () => {
    expect(isSharesFile(emptyShares())).toBe(true);
    expect(isSharesFile({ format: 'outra-coisa', shares: [] })).toBe(false);
    expect(isSharesFile(null)).toBe(false);
  });
});

describe('convite por link', () => {
  it('a chave viaja no link e abre o cofre', async () => {
    const payload = { ...emptyPayload(), items: [itemWith('Passaporte')] };
    const { file, keys } = await createVault(PASSWORD, payload, iterations);

    const { record, secret } = await wrapForLink(keys.data, { label: 'Francine', role: 'writer' });
    const dataKey = await unwrapWithSecret(record, secret);

    expect(record.kind).toBe('link');
    expect((await openVaultWithDataKey(file, dataKey)).items.map((item) => item.name)).toEqual(['Passaporte']);
  });

  it('outro segredo não abre', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const { record } = await wrapForLink(keys.data, { label: 'Francine', role: 'reader' });
    const outro = (await wrapForLink(keys.data, { label: 'Outro', role: 'reader' })).secret;

    await expect(unwrapWithSecret(record, outro)).rejects.toThrow();
  });

  it('o registo continua preso ao seu próprio id', async () => {
    const { keys } = await createVault(PASSWORD, emptyPayload(), iterations);
    const { record, secret } = await wrapForLink(keys.data, { label: 'Francine', role: 'reader' });

    await expect(unwrapWithSecret({ ...record, id: crypto.randomUUID() }, secret)).rejects.toThrow();
  });

  it('o link vai e volta como texto', () => {
    const invite = {
      share: 'abc-123',
      secret: 'c2VncmVkbw==',
      folderId: 'pasta1',
      vaultFileId: 'cofre1',
      sharesFileId: 'partilhas1',
      folderName: 'eQuantic Keeper',
    };
    const link = buildInviteLink('https://keeper.equantic.tech', invite);

    expect(link.startsWith('https://keeper.equantic.tech/#convite=')).toBe(true);
    // Nada de segredo antes do #: só o fragmento carrega a chave.
    expect(link.split('#')[0]).toBe('https://keeper.equantic.tech/');
    expect(readInviteLink(new URL(link).hash)).toEqual(invite);
  });

  it('ignora um fragmento que não é convite', () => {
    expect(readInviteLink('#qualquer-coisa')).toBeNull();
    expect(readInviteLink('')).toBeNull();
    expect(readInviteLink('#convite=%%%')).toBeNull();
  });
});
