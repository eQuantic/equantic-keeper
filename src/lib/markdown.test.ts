import { describe, expect, it } from 'vitest';
import { normalizeBlocks } from './blocks';
import { blocksToMarkdown, markdownFileName } from './markdown';

const blocks = (raw: unknown[]) => normalizeBlocks(raw);

describe('blocksToMarkdown', () => {
  it('escreve os blocos de texto na sintaxe que qualquer editor abre', () => {
    const md = blocksToMarkdown(
      blocks([
        { blockType: 'HEADING_1', content: { text: 'Mudança para Lisboa' }, children: [] },
        { blockType: 'PARAGRAPH', content: { text: 'Pendências da semana.' }, children: [] },
        { blockType: 'BULLET_ITEM', content: { text: 'NIF' }, children: [] },
        { blockType: 'BULLET_ITEM', content: { text: 'NISS' }, children: [] },
        { blockType: 'TODO', content: { text: 'agendar AIMA', checked: true }, children: [] },
        { blockType: 'QUOTE', content: { text: 'sem termo' }, children: [] },
        { blockType: 'DIVIDER', content: {}, children: [] },
        { blockType: 'CODE', content: { code: 'npm run build', language: 'bash' }, children: [] },
      ]),
    );
    expect(md).toBe(
      [
        '# Mudança para Lisboa',
        '',
        'Pendências da semana.',
        '',
        '- NIF',
        '- NISS',
        '- [x] agendar AIMA',
        '',
        '> sem termo',
        '',
        '---',
        '',
        '```bash',
        'npm run build',
        '```',
      ].join('\n'),
    );
  });

  it('numera a lista e recomeça quando ela é interrompida', () => {
    const md = blocksToMarkdown(
      blocks([
        { blockType: 'NUMBERED_ITEM', content: { text: 'um' }, children: [] },
        { blockType: 'NUMBERED_ITEM', content: { text: 'dois' }, children: [] },
        { blockType: 'PARAGRAPH', content: { text: 'no meio' }, children: [] },
        { blockType: 'NUMBERED_ITEM', content: { text: 'um de novo' }, children: [] },
      ]),
    );
    expect(md).toContain('1. um\n2. dois');
    expect(md.trim().endsWith('1. um de novo')).toBe(true);
  });

  it('transforma as marcas em ênfase e links', () => {
    const md = blocksToMarkdown(
      blocks([
        {
          blockType: 'PARAGRAPH',
          content: {
            text: 'renda de 900 euros no site',
            marks: [
              { type: 'bold', from: 9, to: 18 },
              { type: 'link', from: 22, to: 26, href: 'https://exemplo.pt' },
            ],
          },
          children: [],
        },
      ]),
    );
    expect(md).toBe('renda de **900 euros** no [site](https://exemplo.pt)');
  });

  it('leva os filhos de um bloco alternável junto', () => {
    const md = blocksToMarkdown(
      blocks([
        {
          blockType: 'TOGGLE',
          content: { text: 'Detalhes do contrato' },
          children: [{ blockType: 'PARAGRAPH', content: { text: 'senhorio: João' }, children: [] }],
        },
      ]),
    );
    expect(md).toContain('**Detalhes do contrato**');
    expect(md).toContain('senhorio: João');
  });

  it('desenha a tabela com cabeçalho', () => {
    const md = blocksToMarkdown(
      blocks([{ blockType: 'TABLE', content: { rows: [['banco', 'iban'], ['CGD', 'PT50…']] }, children: [] }]),
    );
    expect(md).toBe(['| banco | iban |', '| --- | --- |', '| CGD | PT50… |'].join('\n'));
  });

  it('não escreve nada para uma nota vazia', () => {
    expect(blocksToMarkdown([])).toBe('');
    expect(blocksToMarkdown(undefined)).toBe('');
  });
});

describe('markdownFileName', () => {
  it('faz do título um nome de arquivo seguro', () => {
    expect(markdownFileName('Mudança para Lisboa')).toBe('Mudanca-para-Lisboa.md');
    expect(markdownFileName('  ')).toBe('nota.md');
    expect(markdownFileName('a/b:c*d')).toBe('abcd.md');
  });
});
