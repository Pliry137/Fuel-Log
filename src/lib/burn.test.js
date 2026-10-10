import { describe, it, expect } from 'vitest';
import { pickBurned, appleBurned } from './burn';

const T = '2026-10-10';
describe('pickBurned', () => {
  it('prefers Whoop when both exist', () => {
    expect(pickBurned({ burned: 2900 }, { burned: 2700 }, '2026-10-08', T, 2800))
      .toEqual({ burned: 2900, source: 'whoop' });
  });
  it('falls back to Apple when Whoop is missing', () => {
    expect(pickBurned(undefined, { burned: 2700 }, '2026-10-08', T, 2800))
      .toEqual({ burned: 2700, source: 'apple' });
  });
  it('ignores Apple for today (partial day)', () => {
    expect(pickBurned(undefined, { burned: 2700 }, T, T, 2800)).toEqual({ burned: null, source: null });
  });
  it('ignores Apple days below the floor (charging gap)', () => {
    expect(appleBurned({ burned: 1500 }, '2026-10-08', T, 2800)).toBeNull();
  });
  it('returns null source when neither has data', () => {
    expect(pickBurned(undefined, undefined, '2026-10-08', T, 2800)).toEqual({ burned: null, source: null });
  });
});
