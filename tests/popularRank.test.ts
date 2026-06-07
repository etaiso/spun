import { describe, it, expect } from 'vitest';
import { genreAffinity, scorePopular } from '../app/lib/popularRank';
import type { Station } from '../app/lib/stations';

function station(over: Partial<Station> & { id: string }): Station {
  return {
    name: over.id, streamUrl: `http://x/${over.id}`, favicon: '',
    country: '', countrycode: 'IL', bitrate: 128, codec: 'MP3', ...over,
  };
}

describe('genreAffinity', () => {
  it('is the mean of the station tags scores; unmatched tags count as 0', () => {
    expect(genreAffinity(['pop', 'rock'], { pop: 1, rock: 0 })).toBeCloseTo(0.5, 5);
    expect(genreAffinity(['pop'], { pop: 0.8 })).toBeCloseTo(0.8, 5);
  });

  it('is 0 for a station with no tags or an empty profile', () => {
    expect(genreAffinity(undefined, { pop: 1 })).toBe(0);
    expect(genreAffinity(['pop'], {})).toBe(0);
  });
});

describe('scorePopular', () => {
  it('with an empty profile, orders by popularity (input order) then region', () => {
    const pool = [
      station({ id: 'global-top', countrycode: 'US' }),
      station({ id: 'il-second', countrycode: 'IL' }),
    ];
    const out = scorePopular(pool, { region: 'IL', affinity: {} });
    // il-second gets the region boost (4) which outweighs the 1-slot popularity
    // gap, so it ranks first; verifies regional-first cold-start behavior.
    expect(out.map(s => s.id)).toEqual(['il-second', 'global-top']);
  });

  it('promotes a strong genre match above a more popular non-match', () => {
    const pool = [
      station({ id: 'popular-talk', tags: ['talk'] }),
      station({ id: 'my-genre', tags: ['pop'] }),
    ];
    const out = scorePopular(pool, { region: 'IL', affinity: { pop: 1 } });
    expect(out[0].id).toBe('my-genre');
  });

  it('does not drop any stations (unlike search ranking)', () => {
    const pool = [station({ id: 'a' }), station({ id: 'b' }), station({ id: 'c' })];
    expect(scorePopular(pool, { region: null, affinity: {} })).toHaveLength(3);
  });
});
