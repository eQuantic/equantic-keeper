import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildShareText, mailtoUrl, shareSheetAvailable, shareText } from './share';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildShareText', () => {
  it('renders the item name and one line per field', () => {
    const text = buildShareText('Cartão de Cidadão — a renovar', [
      { label: 'Nº do documento', value: '12345678 9 ZZ1' },
      { label: 'Válido até', value: '2026-09-23' },
    ]);
    expect(text).toBe('Cartão de Cidadão — a renovar\n\nNº do documento: 12345678 9 ZZ1\nVálido até: 2026-09-23');
  });
});

describe('mailtoUrl', () => {
  it('escapes newlines, ampersands and accents', () => {
    const url = mailtoUrl('Título & nota', 'linha 1\nlinha 2');
    expect(url.startsWith('mailto:?subject=')).toBe(true);
    expect(url).toContain('T%C3%ADtulo%20%26%20nota');
    expect(url).toContain('linha%201%0Alinha%202');
    expect(url).not.toContain('\n');
  });
});

describe('shareText', () => {
  it('is unsupported where there is no share sheet', async () => {
    vi.stubGlobal('navigator', {});
    expect(shareSheetAvailable()).toBe(false);
    await expect(shareText('t', 'x')).resolves.toBe('unsupported');
  });

  it('resolves shared on success', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    await expect(shareText('t', 'x')).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 't', text: 'x' });
  });

  it('treats a dismissed sheet as a decision, not an error', async () => {
    vi.stubGlobal('navigator', {
      share: () => Promise.reject(new DOMException('user dismissed', 'AbortError')),
    });
    await expect(shareText('t', 'x')).resolves.toBe('cancelled');
  });

  it('reports real failures as failed', async () => {
    vi.stubGlobal('navigator', { share: () => Promise.reject(new Error('boom')) });
    await expect(shareText('t', 'x')).resolves.toBe('failed');
  });
});
