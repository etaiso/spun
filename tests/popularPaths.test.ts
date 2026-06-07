import { describe, it, expect } from 'vitest';
import { buildPopularPaths } from '../app/lib/popularPaths';

describe('buildPopularPaths', () => {
  it('global only when no region and no genres', () => {
    const paths = buildPopularPaths('', []);
    expect(paths).toEqual([
      '/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true',
    ]);
  });

  it('adds trending + fat regional anchor when a region is known', () => {
    const paths = buildPopularPaths('IL', []);
    expect(paths).toEqual([
      '/json/stations/search?countrycode=IL&order=clicktrend&reverse=true&limit=10&hidebroken=true',
      '/json/stations/bycountrycodeexact/IL?order=clickcount&reverse=true&limit=20&hidebroken=true',
      '/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true',
    ]);
  });

  it('prepends a per-genre regional search per genre when region + genres known', () => {
    const paths = buildPopularPaths('il', ['pop', 'rock']);
    expect(paths.slice(0, 2)).toEqual([
      '/json/stations/search?tag=pop&countrycode=IL&order=clickcount&reverse=true&limit=5&hidebroken=true',
      '/json/stations/search?tag=rock&countrycode=IL&order=clickcount&reverse=true&limit=5&hidebroken=true',
    ]);
    expect(paths).toHaveLength(5); // 2 genre + trending + regional anchor + global
  });

  it('ignores genres when no region is set (per-genre needs a country)', () => {
    expect(buildPopularPaths('', ['pop'])).toEqual([
      '/json/stations?order=clickcount&reverse=true&limit=10&hidebroken=true',
    ]);
  });

  it('url-encodes genre tags with spaces', () => {
    const paths = buildPopularPaths('US', ['hip hop']);
    expect(paths[0]).toContain('tag=hip%20hop');
  });
});
