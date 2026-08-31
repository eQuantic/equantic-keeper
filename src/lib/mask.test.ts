import { describe, expect, it } from 'vitest';
import { applyMask, cardMask, countTyped, maskedCaret, resolveMask, stripMask } from './mask';

const CPF = '000.000.000-00';

describe('applyMask', () => {
  it('formata à medida que se digita', () => {
    expect(applyMask(CPF, '1')).toBe('1');
    expect(applyMask(CPF, '123')).toBe('123');
    expect(applyMask(CPF, '1234')).toBe('123.4');
    expect(applyMask(CPF, '12345678900')).toBe('123.456.789-00');
  });

  it('não deixa pontuação pendurada no fim', () => {
    // "123." parece um erro de digitação; o ponto entra com o próximo dígito.
    expect(applyMask(CPF, '123')).toBe('123');
    expect(applyMask(CPF, '123456')).toBe('123.456');
  });

  it('aceita um valor já formatado sem duplicar a pontuação', () => {
    expect(applyMask(CPF, '123.456.789-00')).toBe('123.456.789-00');
  });

  it('ignora o que passa do tamanho do padrão', () => {
    expect(applyMask(CPF, '1234567890012345')).toBe('123.456.789-00');
  });

  it('descarta caracteres que a posição não aceita', () => {
    // Colar "123abc456" num campo de dígitos não pode travar o valor inteiro.
    expect(applyMask(CPF, '123abc456')).toBe('123.456');
  });

  it('lida com padrões de letras', () => {
    expect(applyMask('00000000 0 AA0', '123456789ZZ1')).toBe('12345678 9 ZZ1');
  });
});

describe('stripMask', () => {
  it('devolve só o que foi digitado', () => {
    expect(stripMask('123.456.789-00')).toBe('12345678900');
    expect(stripMask('12345678 9 ZZ1')).toBe('123456789ZZ1');
  });
});

describe('o cursor', () => {
  it('fica depois do caractere digitado, não depois da pontuação', () => {
    // "123" + "4" → "123.4": o cursor vai para o fim, não antes do ponto.
    expect(maskedCaret('123.4', 4)).toBe(5);
  });

  it('não se perde ao editar no meio', () => {
    // Três dígitos antes do cursor em "123.456.789-00" ficam antes do ponto.
    expect(maskedCaret('123.456.789-00', 3)).toBe(3);
    expect(maskedCaret('123.456.789-00', 4)).toBe(5);
  });

  it('conta os caracteres digitados até uma posição', () => {
    expect(countTyped('123.456.789-00', 5)).toBe(4);
    expect(countTyped('123.456.789-00', 0)).toBe(0);
  });
});

describe('cartões', () => {
  it('agrupa de quatro em quatro por padrão', () => {
    expect(applyMask(cardMask('4111111111111111'), '4111111111111111')).toBe('4111 1111 1111 1111');
  });

  it('conhece o formato do Amex', () => {
    expect(cardMask('378282246310005')).toBe('0000 000000 00000');
    expect(applyMask(cardMask('378282246310005'), '378282246310005')).toBe('3782 822463 10005');
  });

  it('conhece o formato do Diners', () => {
    expect(applyMask(cardMask('30569309025904'), '30569309025904')).toBe('3056 930902 5904');
  });

  it('decide pelos dígitos, não pelo campo da bandeira', () => {
    // A bandeira é texto livre e pode estar vazia ou errada quando se digita.
    expect(cardMask('37')).toBe('0000 000000 00000');
    expect(cardMask('')).toBe('0000 0000 0000 0000');
  });
});

describe('resolveMask', () => {
  it('devolve o padrão fixo quando há um', () => {
    expect(resolveMask({ mask: CPF }, '123')).toBe(CPF);
  });

  it('calcula o do cartão a partir do valor', () => {
    expect(resolveMask({ dynamicMask: 'card' }, '3782')).toBe('0000 000000 00000');
  });

  it('devolve nulo para um campo sem máscara', () => {
    expect(resolveMask({}, 'qualquer coisa')).toBeNull();
  });
});
