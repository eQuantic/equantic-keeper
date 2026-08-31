import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, applyFilters, collectFolders, collectTags, matches } from './search';
import { createItem, type VaultItem } from './model';

function make(overrides: Partial<VaultItem>): VaultItem {
  return { ...createItem('api-token'), name: 'sem nome', ...overrides };
}

const items: VaultItem[] = [
  make({
    id: '1',
    name: 'GitHub PAT — Produção',
    folder: 'Infra',
    tags: ['ci', 'github'],
    fields: { service: 'GitHub', token: 'ghp_supersecret', username: 'edgar' },
  }),
  make({
    id: '2',
    type: 'registry',
    name: 'Azure Container Registry',
    folder: 'Infra',
    tags: ['azure'],
    favorite: true,
    fields: { registry: 'equantic.azurecr.io', password: 'acr-token-value' },
  }),
  make({ id: '3', name: 'Nota antiga', type: 'note', deletedAt: '2026-01-01T00:00:00.000Z' }),
  make({
    id: '4',
    type: 'pt-residencia',
    name: 'Título de residência 2024',
    folder: 'Portugal',
    holderId: 'p-maria',
    fields: { documentNumber: 'RP-99887', entidade: 'AIMA', expiresAt: '2027-03-10' },
  }),
  make({
    id: '5',
    type: 'br-cpf',
    name: 'CPF do João',
    holderId: 'p-joao',
    fields: { cpf: '123.456.789-00' },
  }),
];

const holderNames = new Map([
  ['p-maria', 'Maria Silva'],
  ['p-joao', 'João Silva'],
]);

describe('matches', () => {
  it('finds items by name regardless of accents and case', () => {
    expect(matches(items[0]!, 'producao')).toBe(true);
    expect(matches(items[0]!, 'GITHUB pat')).toBe(true);
  });

  it('requires every term to be present', () => {
    expect(matches(items[0]!, 'github infra')).toBe(true);
    expect(matches(items[0]!, 'github azure')).toBe(false);
  });

  it('searches non-secret fields but never secret values', () => {
    expect(matches(items[1]!, 'azurecr.io')).toBe(true);
    expect(matches(items[0]!, 'ghp_supersecret')).toBe(false);
    expect(matches(items[1]!, 'acr-token-value')).toBe(false);
  });

  it('matches everything on an empty query', () => {
    expect(matches(items[0]!, '   ')).toBe(true);
  });

  it('reaches a document through its type, not only its own text', () => {
    // "título de residência" never says AIMA on the item; the type does.
    expect(matches(items[3]!, 'SEF')).toBe(true);
    expect(matches(items[3]!, 'imigração')).toBe(true);
  });

  it('finds a form by the name the person actually uses', () => {
    const liveBirth = make({ id: '6', type: 'declaracao-nado-vivo', name: 'Do bebê' });
    // The label is the official "nascido vivo"; these are what people type.
    expect(matches(liveBirth, 'nato vivo')).toBe(true);
    expect(matches(liveBirth, 'nado vivo')).toBe(true);
    expect(matches(liveBirth, 'DNV')).toBe(true);

    const payslip = make({ id: '7', type: 'recibo-vencimento', name: 'Agosto' });
    expect(matches(payslip, 'holerite')).toBe(true);
    expect(matches(payslip, 'contracheque')).toBe(true);

    const cpf = items[4]!;
    expect(matches(cpf, 'receita federal')).toBe(true);
  });
});

describe('filtro por pasta', () => {
  it('inclui o que está nas subpastas', () => {
    const parent = make({ id: 'p', name: 'Na pasta', folder: 'Documentos' });
    const child = make({ id: 'c', name: 'Na subpasta', folder: 'Documentos/Portugal' });
    const other = make({ id: 'o', name: 'Fora', folder: 'Documentos-antigos' });
    const filtered = applyFilters([parent, child, other], { ...EMPTY_FILTERS, folder: 'Documentos' }, 'name');
    expect(filtered.map((item) => item.id).sort()).toEqual(['c', 'p']);
  });
});

describe('filtro por país', () => {
  it('separa o mesmo tipo de documento por país emissor', () => {
    const br = make({ id: 'br', type: 'passaporte', name: 'Passaporte BR', country: 'BR' });
    const be = make({ id: 'be', type: 'passaporte', name: 'Passaporte BE', country: 'BE' });
    const semPais = make({ id: 'sem', type: 'passaporte', name: 'Passaporte sem país' });
    const filtered = applyFilters([br, be, semPais], { ...EMPTY_FILTERS, country: 'BE' }, 'name');
    expect(filtered.map((item) => item.id)).toEqual(['be']);
  });
});

describe('applyFilters', () => {
  it('hides trashed items from the active view and vice versa', () => {
    expect(applyFilters(items, EMPTY_FILTERS, 'name').map((item) => item.id)).toEqual(['2', '5', '1', '4']);
    expect(applyFilters(items, { ...EMPTY_FILTERS, view: 'trash' }, 'name').map((item) => item.id)).toEqual(['3']);
  });

  it('filters by type, tag, folder and favourites', () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, type: 'registry' }, 'name')).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, tag: 'ci' }, 'name')).toHaveLength(1);
    expect(applyFilters(items, { ...EMPTY_FILTERS, folder: 'Infra' }, 'name')).toHaveLength(2);
    expect(applyFilters(items, { ...EMPTY_FILTERS, favoritesOnly: true }, 'name')).toHaveLength(1);
  });

  it('ranks exact name matches first', () => {
    const extra = make({ id: '4', name: 'GitHub PAT — Produção (antigo)' });
    const ranked = applyFilters([extra, ...items], { ...EMPTY_FILTERS, query: 'GitHub PAT — Produção' }, 'name');
    expect(ranked[0]?.id).toBe('1');
  });
});

describe('collectTags / collectFolders', () => {
  it('counts only active items', () => {
    expect(collectTags(items).map((entry) => entry.tag).sort()).toEqual(['azure', 'ci', 'github']);
    expect(collectFolders(items)).toEqual([
      { folder: 'Infra', count: 2 },
      { folder: 'Portugal', count: 1 },
    ]);
  });
});

describe('filtro de validade', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const comValidade: VaultItem[] = [
    make({ id: 'v1', type: 'pt-residencia', name: 'Vencido', fields: { expiresAt: day(-3) } }),
    make({ id: 'v2', type: 'passaporte', name: 'Vence logo', fields: { expiresAt: day(20) } }),
    make({ id: 'v3', type: 'passaporte', name: 'Tranquilo', fields: { expiresAt: day(900) } }),
    // Só data de emissão: no passado por natureza, e nunca um alerta.
    make({ id: 'v4', type: 'pt-residencia', name: 'Só emissão', fields: { issuedAt: day(-900) } }),
  ];

  it('separa vencidos de quem vence em breve', () => {
    expect(applyFilters(comValidade, { ...EMPTY_FILTERS, expiry: 'expired' }, 'name').map((i) => i.id)).toEqual([
      'v1',
    ]);
    expect(applyFilters(comValidade, { ...EMPTY_FILTERS, expiry: 'soon' }, 'name').map((i) => i.id)).toEqual([
      'v2',
    ]);
  });

  it('a janela de aviso vem de fora e muda o resultado', () => {
    const largo = applyFilters(comValidade, { ...EMPTY_FILTERS, expiry: 'soon' }, 'name', new Map(), 1000);
    expect(largo.map((item) => item.id)).toEqual(['v3', 'v2']);
  });

  it('sem filtro de validade, nada é escondido', () => {
    expect(applyFilters(comValidade, EMPTY_FILTERS, 'name')).toHaveLength(4);
  });
});

describe('documentos e titulares', () => {
  it('encontra um documento pelo nome do titular, que não fica no item', () => {
    // O item guarda só o `holderId`; quem procura digita "Maria".
    expect(matches(items[3]!, 'maria')).toBe(false);
    expect(matches(items[3]!, 'maria', 'Maria Silva')).toBe(true);
  });

  it('busca pelos dados do documento, que não são segredo', () => {
    expect(matches(items[3]!, 'RP-99887')).toBe(true);
    expect(matches(items[4]!, '123.456.789-00')).toBe(true);
  });

  it('separa o cofre de desenvolvimento do de documentos', () => {
    const docs = applyFilters(items, { ...EMPTY_FILTERS, category: 'doc' }, 'name');
    expect(docs.map((item) => item.id)).toEqual(['5', '4']);
    const dev = applyFilters(items, { ...EMPTY_FILTERS, category: 'dev' }, 'name');
    expect(dev.map((item) => item.id)).toEqual(['2', '1']);
  });

  it('filtra por titular', () => {
    const maria = applyFilters(items, { ...EMPTY_FILTERS, holderId: 'p-maria' }, 'name');
    expect(maria.map((item) => item.id)).toEqual(['4']);
  });

  it('combina titular e busca textual', () => {
    const found = applyFilters(
      items,
      { ...EMPTY_FILTERS, holderId: 'p-joao', query: 'silva' },
      'name',
      holderNames,
    );
    expect(found.map((item) => item.id)).toEqual(['5']);
  });

  it('não devolve nada para um titular sem itens', () => {
    expect(applyFilters(items, { ...EMPTY_FILTERS, holderId: 'p-ninguem' }, 'name')).toEqual([]);
  });
});

describe('números com máscara', () => {
  it('acha pelo número formatado e pelos dígitos soltos', () => {
    const item = { ...createItem('br-cpf'), name: 'CPF', fields: { cpf: '123.456.789-00' } };

    expect(matches(item, '123.456.789-00')).toBe(true);
    // Como a pessoa lembra dele, sem a pontuação.
    expect(matches(item, '12345678900')).toBe(true);
    expect(matches(item, '98765432100')).toBe(false);
  });
});
