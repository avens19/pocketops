import { describe, expect, it } from 'vitest';

import { formatUnit } from './format';

describe('formatUnit', () => {
  it('formats bytes in binary steps', () => {
    expect(formatUnit(512, 'By')).toBe('512 B');
    expect(formatUnit(1536, 'By')).toBe('1.50 KB');
    expect(formatUnit(360 * 1024 * 1024, 'By')).toBe('360 MB');
    expect(formatUnit(5 * 1024 ** 3, 'By')).toBe('5.00 GB');
    expect(formatUnit(2048, 'By/s')).toBe('2.00 KB/s');
  });

  it('formats durations from any time unit', () => {
    expect(formatUnit(1_500_000, 'ns')).toBe('1.5 ms');
    expect(formatUnit(2500, 'us')).toBe('2.5 ms');
    expect(formatUnit(1500, 'ms')).toBe('1.5 s');
    expect(formatUnit(2, 's')).toBe('2.0 s');
  });

  it('falls back to a compact number for plain or unknown units', () => {
    expect(formatUnit(0.274, '1')).toBe('0.27');
    expect(formatUnit(18594, '{request}')).toBe('18.6k');
    expect(formatUnit(12.5, '%')).toBe('12.50%');
    expect(formatUnit(3, undefined)).toBe('3.00');
  });

  it('survives non-finite input', () => {
    expect(formatUnit(NaN, 'By')).toBe('–');
  });
});
