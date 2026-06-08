import { describe, it, expect } from 'vitest';
import {
  buildStationsPath,
  normalizeCountries,
  normalizeTags,
  countryCodesFromStations,
} from '../app/lib/explorePaths';

describe('buildStationsPath', () => {
  it('filters by country only (uppercased) with ordering + hidebroken', () => {
    const p = buildStationsPath({ country: 'de' });
    expect(p).toContain('countrycode=DE');
    expect(p).not.toContain('tagList=');
    expect(p).toContain('order=clickcount');
    expect(p).toContain('reverse=true');
    expect(p).toContain('hidebroken=true');
    expect(p).toContain('limit=100');
  });

  it('filters by a single tag via tagList (lowercased + url-encoded)', () => {
    const p = buildStationsPath({ tags: ['Hip Hop'] });
    expect(p).toContain('tagList=hip%20hop');
    expect(p).not.toContain('countrycode=');
  });

  it('ANDs multiple tags as a comma-separated tagList', () => {
    const p = buildStationsPath({ tags: ['jazz', 'blues'] });
    expect(p).toContain('tagList=jazz,blues');
  });

  it('ANDs country + tags when both are given', () => {
    const p = buildStationsPath({ country: 'US', tags: ['jazz', 'soul'] });
    expect(p).toContain('countrycode=US');
    expect(p).toContain('tagList=jazz,soul');
  });

  it('ignores empty/nullish facets and honours a custom limit', () => {
    const p = buildStationsPath({ country: '', tags: ['rock', '', '  '] }, 25);
    expect(p).not.toContain('countrycode=');
    expect(p).toContain('tagList=rock');
    expect(p).toContain('limit=25');
  });
});

describe('normalizeCountries', () => {
  it('maps fields, drops invalid/zero, and sorts by count desc', () => {
    const out = normalizeCountries([
      { name: 'Germany', iso_3166_1: 'DE', stationcount: 3000 },
      { name: 'Israel', iso_3166_1: 'IL', stationcount: 200 },
      { name: 'United States', iso_3166_1: 'US', stationcount: 5000 },
      { name: 'Nowhere', iso_3166_1: 'XX', stationcount: 0 },   // zero stations
      { name: 'Bad', iso_3166_1: 'X', stationcount: 10 },        // not 2 letters
      { name: '', iso_3166_1: 'FR', stationcount: 10 },          // empty name
    ]);
    expect(out).toEqual([
      { code: 'US', name: 'United States', count: 5000 },
      { code: 'DE', name: 'Germany', count: 3000 },
      { code: 'IL', name: 'Israel', count: 200 },
    ]);
  });

  it('dedupes by code and tolerates non-arrays', () => {
    const out = normalizeCountries([
      { name: 'Germany', iso_3166_1: 'DE', stationcount: 3000 },
      { name: 'Germany dup', iso_3166_1: 'de', stationcount: 1 },
    ]);
    expect(out).toEqual([{ code: 'DE', name: 'Germany', count: 3000 }]);
    expect(normalizeCountries(null)).toEqual([]);
    expect(normalizeCountries({})).toEqual([]);
  });
});

describe('normalizeTags', () => {
  it('lowercases, dedupes, drops below min, sorts, and caps', () => {
    const out = normalizeTags(
      [
        { name: 'Pop', stationcount: 900 },
        { name: 'pop', stationcount: 1 },     // dup (kept first/highest)
        { name: 'jazz', stationcount: 300 },
        { name: 'obscure', stationcount: 2 }, // below min
        { name: '', stationcount: 500 },      // empty
      ],
      { min: 5, cap: 2 },
    );
    expect(out).toEqual([
      { name: 'pop', count: 900 },
      { name: 'jazz', count: 300 },
    ]);
  });

  it('tolerates non-arrays', () => {
    expect(normalizeTags(null)).toEqual([]);
  });
});

describe('countryCodesFromStations', () => {
  it('returns distinct, uppercased, sorted codes; drops invalid/empty', () => {
    const out = countryCodesFromStations([
      { countrycode: 'de' },
      { countrycode: 'US' },
      { countrycode: 'DE' },   // dup
      { countrycode: '' },     // empty
      { countrycode: 'XYZ' },  // not 2 letters
      {},                       // missing
    ]);
    expect(out).toEqual(['DE', 'US']);
  });

  it('tolerates non-arrays', () => {
    expect(countryCodesFromStations(null)).toEqual([]);
  });
});
