/*
 * A zone with daylight saving, set before any date is built: the bug this file
 * pins only exists where a day can be 23 or 25 hours long, so in UTC — or in
 * any zone without DST — every assertion below would pass on the broken code.
 */
process.env.TZ = 'Europe/Lisbon';

import { describe, expect, it } from 'vitest';
import { expiryOf } from './expiry';
import { createItem, type VaultItem } from './model';

function doc(expiresAt: string): VaultItem {
  return { ...createItem('pt-residencia'), name: 'Cartão de Cidadão', fields: { expiresAt } };
}

/** A local wall-clock instant in Lisbon. */
const at = (local: string) => new Date(local).getTime();

describe('dias até vencer, nas noites em que o relógio muda', () => {
  it('o fuso deste teste tem mesmo horário de verão', () => {
    // Sem isto, tudo abaixo passaria num runner em UTC e não provaria nada.
    expect(new Date('2026-07-01T12:00:00').getTimezoneOffset()).toBe(-60);
    expect(new Date('2026-12-01T12:00:00').getTimezoneOffset()).toBe(0);
  });

  it('não conta um dia a mais depois da meia-noite, quando o relógio atrasa pelo caminho', () => {
    // 25/10/2026 é o último domingo de outubro: Portugal atrasa uma hora, e esse
    // dia tem 25. Entre 00h e 01h a conta antiga dizia 26.
    for (const time of ['00:00', '00:03', '00:59', '01:30', '14:00', '23:59']) {
      expect(expiryOf(doc('2026-10-25'), 60, at(`2026-09-30T${time}:00`))?.days, time).toBe(25);
    }
  });

  it('não conta um dia a menos antes da meia-noite, quando o relógio adianta pelo caminho', () => {
    // 28/03/2027 é o último domingo de março: o dia tem 23 horas. Entre 23h e
    // meia-noite a conta antiga dizia 29.
    for (const time of ['00:30', '12:00', '23:00', '23:30', '23:59']) {
      expect(expiryOf(doc('2027-03-31'), 60, at(`2027-03-01T${time}:00`))?.days, time).toBe(30);
    }
  });

  it('e o estado acompanha a contagem certa na borda da janela de aviso', () => {
    // 60 dias exatos antes de 29/11/2026, com a mudança de 25/10 no meio: "em
    // breve", e não "tranquilo" por um dia imaginário a mais.
    expect(expiryOf(doc('2026-11-29'), 60, at('2026-09-30T00:30:00'))).toMatchObject({ days: 60, status: 'soon' });
  });
});
