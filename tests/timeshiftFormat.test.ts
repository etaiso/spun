import { describe, it, expect } from 'vitest';
import { fmtBehind, fmtWallClock } from '../app/lib/timeshift/format';

describe('fmtBehind', () => {
  it('formats minutes:seconds zero-padded', () => {
    expect(fmtBehind(204)).toBe('−03:24');
  });
  it('rounds total seconds first (119.6 s is −02:00, not −01:60)', () => {
    expect(fmtBehind(119.6)).toBe('−02:00');
  });
  it('shows an hours segment past one hour', () => {
    expect(fmtBehind(3744)).toBe('−1:02:24');
  });
  it('clamps negatives to zero', () => {
    expect(fmtBehind(-3)).toBe('−00:00');
  });
});

describe('fmtWallClock', () => {
  it('renders a locale time with seconds', () => {
    expect(fmtWallClock(Date.UTC(2026, 5, 10, 14, 32, 5))).toMatch(/\d{1,2}:\d{2}:\d{2}/);
  });
});
