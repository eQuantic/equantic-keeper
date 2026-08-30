import { describe, expect, it } from 'vitest';
import { collectExpiring, describeExpiry, endOfPeriod, expiryOf, isExpiryField, statusOf } from './expiry';
import { createItem, type VaultItem } from './model';

/** Fixed clock: "today" is 10 de março de 2026, midday. */
const NOW = Date.parse('2026-03-10T12:00:00');

/** `days` from today as the app stores dates: a plain YYYY-MM-DD. */
function day(offset: number): string {
  return new Date(NOW + offset * 86_400_000).toISOString().slice(0, 10);
}

function doc(fields: Record<string, string>, overrides: Partial<VaultItem> = {}): VaultItem {
  return { ...createItem('pt-residencia'), name: 'Título', fields, ...overrides };
}

describe('expiryOf', () => {
  it('lê o campo de validade do documento', () => {
    const found = expiryOf(doc({ expiresAt: day(10) }), 60, NOW);
    expect(found).toMatchObject({ fieldId: 'expiresAt', label: 'Válido até', days: 10, status: 'soon' });
  });

  /**
   * O bug que motivou este módulo: tratar toda data como validade fazia um
   * documento *emitido* em 2020 aparecer em vermelho como expirado.
   */
  it('ignora a data de emissão, que está no passado por natureza', () => {
    expect(expiryOf(doc({ issuedAt: '2020-01-01' }), 60, NOW)).toBeNull();
    expect(isExpiryField('issuedAt')).toBe(false);
    expect(isExpiryField('expiresAt')).toBe(true);
  });

  it('vale até o fim do último dia', () => {
    // Um passaporte que vence hoje ainda serve hoje.
    expect(expiryOf(doc({ expiresAt: day(0) }), 60, NOW)).toMatchObject({ days: 0, status: 'soon' });
    expect(expiryOf(doc({ expiresAt: day(-1) }), 60, NOW)).toMatchObject({ days: -1, status: 'expired' });
  });

  it('escolhe a data que vence primeiro', () => {
    const contrato = { ...createItem('pt-arrendamento'), fields: { endsAt: day(5) } };
    expect(expiryOf(contrato, 60, NOW)?.days).toBe(5);
  });

  it('devolve null sem data, com data vazia ou com data inválida', () => {
    expect(expiryOf(doc({}), 60, NOW)).toBeNull();
    expect(expiryOf(doc({ expiresAt: '   ' }), 60, NOW)).toBeNull();
    expect(expiryOf(doc({ expiresAt: 'quando renovar' }), 60, NOW)).toBeNull();
  });

  it('respeita a janela de aviso configurada', () => {
    const item = doc({ expiresAt: day(45) });
    expect(expiryOf(item, 60, NOW)?.status).toBe('soon');
    expect(expiryOf(item, 30, NOW)?.status).toBe('ok');
  });
});

describe('statusOf', () => {
  it('separa expirado, próximo e tranquilo', () => {
    expect(statusOf(-1, 60)).toBe('expired');
    expect(statusOf(0, 60)).toBe('soon');
    expect(statusOf(60, 60)).toBe('soon');
    expect(statusOf(61, 60)).toBe('ok');
  });
});

describe('collectExpiring', () => {
  const items = [
    doc({ expiresAt: day(400) }, { id: 'tranquilo' }),
    doc({ expiresAt: day(20) }, { id: 'proximo' }),
    doc({ expiresAt: day(-5) }, { id: 'vencido' }),
    doc({ issuedAt: '2019-05-01' }, { id: 'so-emissao' }),
    doc({ expiresAt: day(1) }, { id: 'na-lixeira', deletedAt: '2026-03-01T00:00:00.000Z' }),
  ];

  it('lista do mais urgente ao menos urgente', () => {
    expect(collectExpiring(items, 60, NOW).map((entry) => entry.itemId)).toEqual(['vencido', 'proximo']);
  });

  it('não cobra atenção por item na lixeira', () => {
    expect(collectExpiring(items, 60, NOW).some((entry) => entry.itemId === 'na-lixeira')).toBe(false);
  });

  it('amplia a lista quando a janela de aviso cresce', () => {
    expect(collectExpiring(items, 500, NOW)).toHaveLength(3);
  });
});

describe('describeExpiry', () => {
  const at = (days: number) => describeExpiry(expiryOf(doc({ expiresAt: day(days) }), 60, NOW)!);

  it('fala em português de gente', () => {
    expect(at(0)).toBe('expira hoje');
    expect(at(1)).toBe('expira amanhã');
    expect(at(12)).toBe('expira em 12 dias');
    expect(at(-1)).toBe('expirou ontem');
    expect(at(-3)).toBe('expirou há 3 dias');
  });

  it('vira meses quando os dias deixam de ajudar', () => {
    expect(at(90)).toBe('expira em 3 meses');
  });
});

describe('validade em mês', () => {
  it('trata o mês impresso como o último dia dele', () => {
    // Um cartão "09/2028" ainda vale no dia 30; só expira em outubro.
    expect(endOfPeriod('2028-09')).toBe('2028-09-30');
    expect(endOfPeriod('2028-02')).toBe('2028-02-29');
    expect(endOfPeriod('2027-02')).toBe('2027-02-28');
    expect(endOfPeriod('2028-09-15')).toBe('2028-09-15');
  });

  it('conta os dias até o fim do mês, não até o dia 1º', () => {
    const card = { ...createItem('cartao-credito'), name: 'Cartão', fields: { expiresAt: '2026-03' } };
    // Hoje é 10 de março de 2026: o cartão ainda tem o resto do mês.
    expect(expiryOf(card, 60, NOW)).toMatchObject({ days: 21, status: 'soon' });
  });

  it('marca como vencido o mês que já passou', () => {
    const card = { ...createItem('cartao-credito'), name: 'Cartão', fields: { expiresAt: '2026-02' } };
    expect(expiryOf(card, 60, NOW)?.status).toBe('expired');
  });
});
