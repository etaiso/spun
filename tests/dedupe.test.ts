import { describe, it, expect } from 'vitest';
import { dedupeStations } from '../app/lib/dedupe';
import type { Station } from '../app/lib/stations';

function station(over: Partial<Station> & { id: string; name: string }): Station {
  return {
    streamUrl: `http://stream/${over.id}`,
    favicon: '', country: '', countrycode: 'IL', bitrate: 128, codec: 'MP3',
    ...over,
  };
}

describe('dedupeStations tag union', () => {
  it('merges tags from a collapsed duplicate into the survivor', () => {
    const out = dedupeStations([
      station({ id: '1', name: 'גלגלצ - Glglz', tags: ['pop', 'rock'] }),
      station({ id: '2', name: 'Glglz', tags: ['rock', 'israeli'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1'); // first occurrence wins
    expect([...(out[0].tags ?? [])].sort()).toEqual(['israeli', 'pop', 'rock']);
  });

  it('gives the survivor tags when it had none but a duplicate did', () => {
    const out = dedupeStations([
      station({ id: '1', name: 'Glglz' }),
      station({ id: '2', name: 'גלגלצ - Glglz', tags: ['pop'] }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].tags).toEqual(['pop']);
  });

  it('leaves a lone station untouched', () => {
    const out = dedupeStations([station({ id: '1', name: 'Solo', tags: ['jazz'] })]);
    expect(out[0].tags).toEqual(['jazz']);
  });
});
