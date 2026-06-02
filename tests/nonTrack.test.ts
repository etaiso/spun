import { describe, it, expect } from 'vitest';
import { isNonTrack } from '../app/lib/nonTrack';

describe('isNonTrack', () => {
  it('flags empty title', () => {
    expect(isNonTrack('', 'Jazz FM')).toBe(true);
    expect(isNonTrack('   ', 'Jazz FM')).toBe(true);
  });

  it('flags title equal to station name (case-insensitive)', () => {
    expect(isNonTrack('Jazz FM', 'Jazz FM')).toBe(true);
    expect(isNonTrack('JAZZ FM', 'jazz fm')).toBe(true);
  });

  it('flags short title without a dash separator', () => {
    expect(isNonTrack('ID', 'Jazz FM')).toBe(true);
    expect(isNonTrack('AD', 'Jazz FM')).toBe(true);
  });

  it('does NOT flag normal track titles', () => {
    expect(isNonTrack('Miles Davis - So What', 'Jazz FM')).toBe(false);
    expect(isNonTrack('Coltrane — Naima', 'Jazz FM')).toBe(false);
  });

  it('does NOT flag a longer title even without a dash', () => {
    expect(isNonTrack('Loose Ends Loose Ends', 'Jazz FM')).toBe(false);
  });
});
