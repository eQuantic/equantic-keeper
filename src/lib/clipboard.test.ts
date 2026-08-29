import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The module keeps the pending-wipe state at module scope, so every test gets
 * a fresh copy via resetModules. navigator is stubbed because the node test
 * environment has no clipboard.
 */
type ClipboardModule = typeof import('./clipboard');

let mod: ClipboardModule;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {
    clipboard: { writeText, readText: vi.fn() },
    permissions: undefined,
  });
  vi.resetModules();
  mod = await import('./clipboard');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('copySecret', () => {
  it('writes the value and wipes it after the timeout', async () => {
    const result = await mod.copySecret('s3cr3t', 30);
    expect(result.ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith('s3cr3t');

    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeText).toHaveBeenLastCalledWith('');
  });

  it('reports failure when the browser blocks the clipboard', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    const result = await mod.copySecret('s3cr3t', 30);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('does not schedule a wipe when clearing is disabled', async () => {
    await mod.copySecret('s3cr3t', 0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe('resumePendingClear', () => {
  it('wipes immediately when the deadline passed while suspended', async () => {
    await mod.copySecret('s3cr3t', 30);

    // The phone froze the page before the timer fired; the user comes back
    // two minutes later.
    await mod.resumePendingClear(Date.now() + 120_000);
    expect(writeText).toHaveBeenLastCalledWith('');
  });

  it('re-arms the timer for the remaining time when coming back early', async () => {
    await mod.copySecret('s3cr3t', 30);

    await mod.resumePendingClear(Date.now() + 10_000);
    expect(writeText).toHaveBeenCalledTimes(1); // not wiped yet

    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeText).toHaveBeenLastCalledWith('');
  });

  it('does nothing once the wipe already ran', async () => {
    await mod.copySecret('s3cr3t', 30);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeText).toHaveBeenCalledTimes(2);

    await mod.resumePendingClear(Date.now() + 600_000);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('does nothing when nothing was copied', async () => {
    await mod.resumePendingClear();
    expect(writeText).not.toHaveBeenCalled();
  });
});
