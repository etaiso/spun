import { describe, it, expect } from 'vitest';
import { isNonTrack, isJunkMetadata } from '../app/lib/nonTrack';

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

  it('flags CDN / station branding as a non-track', () => {
    expect(isNonTrack('Powered By Multix Technologies CDN', 'Radios 100FM')).toBe(true);
    expect(isNonTrack('CDN - Powered By Multix Technologies', 'Radios 100FM')).toBe(true);
  });
});

describe('isJunkMetadata', () => {
  it('flags empty / whitespace', () => {
    expect(isJunkMetadata('')).toBe(true);
    expect(isJunkMetadata('   ')).toBe(true);
  });

  it('flags CDN / branding / filler markers (case-insensitive)', () => {
    expect(isJunkMetadata('Powered By Multix Technologies')).toBe(true);
    expect(isJunkMetadata('powered by some cdn')).toBe(true);
    expect(isJunkMetadata('Advertisement')).toBe(true);
    expect(isJunkMetadata('Commercial Break')).toBe(true);
  });

  it('does NOT flag real song titles', () => {
    expect(isJunkMetadata('Miles Davis - So What')).toBe(false);
    expect(isJunkMetadata('Daft Punk - Around the World')).toBe(false);
  });
});
