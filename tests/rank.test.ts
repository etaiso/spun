import { describe, it, expect } from 'vitest';
import { fuzzyScore, rankStations } from '../app/lib/rank';
import type { Station } from '../app/lib/stations';

function station(over: Partial<Station> & { id: string; name: string }): Station {
  return {
    streamUrl: 'http://x',
    favicon: '',
    country: '',
    countrycode: '',
    bitrate: 128,
    codec: 'MP3',
    ...over,
  };
}

describe('fuzzyScore', () => {
  it('ranks exact > prefix > word-prefix > substring > subsequence', () => {
    const exact = fuzzyScore('jazz', 'jazz');
    const prefix = fuzzyScore('jazz', 'jazz radio');
    const wordPrefix = fuzzyScore('radio', 'jazz radio');
    const substring = fuzzyScore('zz', 'jazz');
    const subseq = fuzzyScore('jzz', 'jazz');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordPrefix);
    expect(wordPrefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('JAZZ', 'jazz')).toBe(1);
  });

  it('returns 0 when chars are missing', () => {
    expect(fuzzyScore('xyz', 'jazz radio')).toBe(0);
  });

  it('returns 0 for empty query', () => {
    expect(fuzzyScore('', 'jazz')).toBe(0);
  });
});

describe('rankStations', () => {
  const ctx = (over: Partial<Parameters<typeof rankStations>[1]> = {}) => ({
    query: 'radio',
    region: null,
    recentIds: new Set<string>(),
    favoriteIds: new Set<string>(),
    ...over,
  });

  it('drops non-matching stations', () => {
    const list = [station({ id: 'a', name: 'Jazz Radio' }), station({ id: 'b', name: 'Pop FM' })];
    const out = rankStations(list, ctx());
    expect(out.map(s => s.id)).toEqual(['a']);
  });

  it('boosts the user region above an equally-matching foreign station', () => {
    const foreign = station({ id: 'us', name: 'Radio One', countrycode: 'US' });
    const local = station({ id: 'il', name: 'Radio One', countrycode: 'IL' });
    const out = rankStations([foreign, local], ctx({ region: 'IL' }));
    expect(out[0].id).toBe('il');
  });

  it('ranks a recently-played match above a non-recent one, even over region', () => {
    const localPopular = station({ id: 'il', name: 'Radio Two', countrycode: 'IL' });
    const recentForeign = station({ id: 'us', name: 'Radio Two', countrycode: 'US' });
    const out = rankStations([localPopular, recentForeign], ctx({
      region: 'IL',
      recentIds: new Set(['us']),
    }));
    expect(out[0].id).toBe('us'); // recent boost (18) > region boost (12)
  });

  it('keeps strong relevance ahead of a weak (subsequence-only) match with every boost', () => {
    const strong = station({ id: 'strong', name: 'Radio', countrycode: 'US' });
    // "radio" only appears as a scattered subsequence here (weak fuzzy ~0.2).
    const weakLocalRecent = station({ id: 'weak', name: 'Retro Audio Mix', countrycode: 'IL' });
    const out = rankStations([strong, weakLocalRecent], ctx({
      region: 'IL',
      recentIds: new Set(['weak']),
      favoriteIds: new Set(['weak']),
    }));
    expect(out[0].id).toBe('strong'); // fuzzy dominance beats region+recent+favorite boosts
  });
});
