import { describe, expect, it } from 'vitest';

import { isForeground } from './app-state';

describe('isForeground', () => {
  it('is true while active', () => {
    expect(isForeground('active')).toBe(true);
  });

  it('is false only for an explicit background or inactive state', () => {
    expect(isForeground('background')).toBe(false);
    expect(isForeground('inactive')).toBe(false);
  });

  it('is true when the state has not settled yet, as at launch of a release build', () => {
    expect(isForeground('unknown')).toBe(true);
    expect(isForeground(null)).toBe(true);
    expect(isForeground(undefined)).toBe(true);
  });
});
