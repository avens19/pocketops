import { describe, expect, it, vi } from 'vitest';
import { createRequestPool } from './request-pool';
import { stackBars } from './chart-stacks';

describe('dashboard request scheduling', () => {
  it('bounds concurrency, skips cancelled queued work, and releases slots after failures', async () => {
    const pool = createRequestPool(1);
    let finish!: () => void;
    const first = pool(() => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    const abort = new AbortController();
    const skipped = vi.fn(async () => 2);
    const cancelled = pool(skipped, abort.signal).catch((e: Error) => e.name);
    const later = vi.fn(async () => { throw new Error('network'); });
    const second = pool(later).catch((e: Error) => e.message);
    abort.abort(); finish();
    expect(await cancelled).toBe('AbortError'); await first;
    expect(await second).toBe('network');
    expect(skipped).not.toHaveBeenCalled(); expect(later).toHaveBeenCalledTimes(1);
    expect(await pool(async () => 3)).toBe(3);
  });
  it('stacks series at matching timestamps without treating missing samples as observations', () => {
    const bars = stackBars([{ name: 'a', labels: {}, points: [{ t: 1, v: 2 }, { t: 2, v: -3 }] }, { name: 'b', labels: {}, points: [{ t: 1, v: 4 }, { t: 2, v: -1 }, { t: 3, v: 7 }] }]);
    expect(bars).toEqual([{ t: 1, base: 0, top: 2, index: 0 }, { t: 2, base: 0, top: -3, index: 0 }, { t: 1, base: 2, top: 6, index: 1 }, { t: 2, base: -3, top: -4, index: 1 }, { t: 3, base: 0, top: 7, index: 1 }]);
  });
});
