import { describe, expect, it } from 'vitest';
import { blocksToPlainText, isEmptyBlocks, normalizeBlocks, toEditorInput, type Block } from './blocks';
import { blocksToDoc } from './editor/blocks-to-pm';
import { docToBlocks } from './editor/pm-to-blocks';

const paragraph = (text: string, marks: unknown[] = []): Block => ({
  id: 'b1',
  blockType: 'PARAGRAPH',
  content: { text, ...(marks.length ? { marks } : {}) },
  children: [],
});

describe('normalizeBlocks', () => {
  it('mantém o que reconhece e descarta o resto', () => {
    const blocks = normalizeBlocks([
      { id: 'a', blockType: 'HEADING_1', content: { text: 'Título' }, children: [] },
      { id: 'b', blockType: 'INVENTADO', content: { text: 'some' }, children: [] },
      'não é bloco',
      { blockType: 'PARAGRAPH' },
    ]);
    expect(blocks.map((block) => block.blockType)).toEqual(['HEADING_1', 'PARAGRAPH']);
    // Um bloco sem id é válido: o id é atribuído quando o editor abre.
    expect(blocks[1]?.id).toBeNull();
  });

  it('recorta marcas que apontam para fora do texto', () => {
    // Uma marca além do fim do texto faz o editor estourar ao abrir a nota.
    const [block] = normalizeBlocks([
      {
        blockType: 'PARAGRAPH',
        content: { text: 'curto', marks: [{ type: 'bold', from: 2, to: 999 }, { type: 'italic', from: 4, to: 1 }] },
        children: [],
      },
    ]);
    expect(block?.content.marks).toEqual([{ type: 'bold', from: 2, to: 5 }]);
  });

  it('não deixa conteúdo estranho entrar', () => {
    const [block] = normalizeBlocks([
      { blockType: 'PARAGRAPH', content: { text: 'oi', evil: { nested: true }, checked: true }, children: [] },
    ]);
    expect(block?.content).toEqual({ text: 'oi', checked: true });
  });

  it('para de descer numa árvore absurdamente profunda', () => {
    let deep: unknown = { blockType: 'PARAGRAPH', content: { text: 'fundo' }, children: [] };
    for (let level = 0; level < 40; level += 1) {
      deep = { blockType: 'TOGGLE', content: { text: `n${level}` }, children: [deep] };
    }
    let node = normalizeBlocks([deep])[0];
    let depth = 0;
    while (node?.children[0]) {
      node = node.children[0];
      depth += 1;
    }
    expect(depth).toBeLessThanOrEqual(12);
  });
});

describe('conteúdo de uma nota', () => {
  it('vira texto plano para a busca, inclusive dentro de filhos e tabelas', () => {
    const blocks = normalizeBlocks([
      { blockType: 'HEADING_1', content: { text: 'Mudança' }, children: [] },
      { blockType: 'TODO', content: { text: 'pedir NIF', checked: false }, children: [] },
      {
        blockType: 'TOGGLE',
        content: { text: 'Detalhes' },
        children: [{ blockType: 'PARAGRAPH', content: { text: 'senhorio: João' }, children: [] }],
      },
      { blockType: 'TABLE', content: { rows: [['banco', 'iban']] }, children: [] },
    ]);
    const text = blocksToPlainText(blocks);
    expect(text).toContain('Mudança');
    expect(text).toContain('pedir NIF');
    expect(text).toContain('senhorio: João');
    expect(text).toContain('banco iban');
  });

  it('reconhece uma nota vazia', () => {
    expect(isEmptyBlocks(undefined)).toBe(true);
    expect(isEmptyBlocks([paragraph('   ')])).toBe(true);
    expect(isEmptyBlocks([paragraph('algo')])).toBe(false);
  });
});

describe('ida e volta pelo editor', () => {
  it('preserva tipos, texto e marcas', () => {
    const original = normalizeBlocks([
      { id: 'h', blockType: 'HEADING_2', content: { text: 'Contrato' }, children: [] },
      {
        id: 'p',
        blockType: 'PARAGRAPH',
        content: { text: 'renda de 900 euros', marks: [{ type: 'bold', from: 9, to: 18 }] },
        children: [],
      },
      { id: 't', blockType: 'TODO', content: { text: 'assinar', checked: true }, children: [] },
      { id: 'q', blockType: 'QUOTE', content: { text: 'sem termo' }, children: [] },
      { id: 'c', blockType: 'CODE', content: { code: 'npm run build', language: 'bash' }, children: [] },
      { id: 'd', blockType: 'DIVIDER', content: {}, children: [] },
    ]);

    const round = docToBlocks(blocksToDoc(toEditorInput(original)));

    expect(round.map((block) => block.blockType)).toEqual([
      'HEADING_2',
      'PARAGRAPH',
      'TODO',
      'QUOTE',
      'CODE',
      'DIVIDER',
    ]);
    expect(round[1]?.content).toMatchObject({
      text: 'renda de 900 euros',
      marks: [{ type: 'bold', from: 9, to: 18 }],
    });
    expect(round[2]?.content).toMatchObject({ text: 'assinar', checked: true });
    expect(round[4]?.content).toMatchObject({ code: 'npm run build', language: 'bash' });
  });
});
