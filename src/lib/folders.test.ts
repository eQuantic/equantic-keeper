import { describe, expect, it } from 'vitest';
import {
  buildFolderTree,
  flattenFolderTree,
  folderAncestors,
  folderLeaf,
  folderParent,
  isDescendantFolder,
  isWithinFolder,
  movedFolderPath,
  normalizeFolderPath,
  rewriteFolderPath,
} from './folders';

describe('caminhos de pasta', () => {
  it('normaliza o que a pessoa digita', () => {
    expect(normalizeFolderPath(' Documentos / Portugal ')).toBe('Documentos/Portugal');
    expect(normalizeFolderPath('//a///b//')).toBe('a/b');
    expect(normalizeFolderPath('   ')).toBe('');
  });

  it('sabe o nome, o pai e os ancestrais', () => {
    expect(folderLeaf('Documentos/Portugal/2026')).toBe('2026');
    expect(folderParent('Documentos/Portugal/2026')).toBe('Documentos/Portugal');
    expect(folderParent('Documentos')).toBe('');
    expect(folderAncestors('Documentos/Portugal/2026')).toEqual(['Documentos', 'Documentos/Portugal']);
  });

  it('distingue estar dentro de ser a própria pasta', () => {
    expect(isWithinFolder('Documentos/Portugal', 'Documentos')).toBe(true);
    expect(isWithinFolder('Documentos', 'Documentos')).toBe(true);
    expect(isDescendantFolder('Documentos', 'Documentos')).toBe(false);
    // Prefixo não basta: "Documentos-antigos" não está em "Documentos".
    expect(isWithinFolder('Documentos-antigos', 'Documentos')).toBe(false);
  });

  it('move uma pasta mantendo o próprio nome', () => {
    expect(movedFolderPath('Documentos/Portugal', 'Arquivo')).toBe('Arquivo/Portugal');
    expect(movedFolderPath('Documentos/Portugal', '')).toBe('Portugal');
  });

  it('reescreve a subárvore junto com a pasta movida', () => {
    expect(rewriteFolderPath('Documentos/Portugal/2026', 'Documentos/Portugal', 'Arquivo/Portugal')).toBe(
      'Arquivo/Portugal/2026',
    );
    expect(rewriteFolderPath('Outra', 'Documentos/Portugal', 'Arquivo/Portugal')).toBe('Outra');
  });
});

describe('árvore de pastas', () => {
  const counts = new Map([
    ['Documentos/Portugal', 2],
    ['Documentos/Brasil', 1],
    ['Infra', 3],
  ]);

  it('inventa os níveis intermediários que ninguém criou', () => {
    // Só existem itens em "Documentos/Portugal": "Documentos" precisa existir
    // na árvore, ou seus filhos ficariam inalcançáveis.
    const tree = buildFolderTree(['Documentos/Portugal', 'Documentos/Brasil', 'Infra'], counts);
    expect(tree.map((node) => node.path)).toEqual(['Documentos', 'Infra']);
    expect(tree[0]?.children.map((node) => node.name)).toEqual(['Brasil', 'Portugal']);
  });

  it('soma os itens da subárvore no pai', () => {
    const tree = buildFolderTree(['Documentos/Portugal', 'Documentos/Brasil', 'Infra'], counts);
    expect(tree[0]?.count).toBe(0);
    expect(tree[0]?.total).toBe(3);
    expect(tree[1]?.total).toBe(3);
  });

  it('esconde os filhos de uma pasta recolhida', () => {
    const tree = buildFolderTree(['Documentos/Portugal', 'Documentos/Brasil', 'Infra'], counts);
    expect(flattenFolderTree(tree, new Set()).map((node) => node.path)).toEqual(['Documentos', 'Infra']);
    expect(flattenFolderTree(tree, new Set(['Documentos'])).map((node) => node.path)).toEqual([
      'Documentos',
      'Documentos/Brasil',
      'Documentos/Portugal',
      'Infra',
    ]);
  });
});
