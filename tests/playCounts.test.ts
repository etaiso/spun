import { describe, it, expect } from 'vitest';
import { bumpPlay, parsePlayCounts } from '../app/lib/playCounts';
import type { PlayCounts } from '../app/lib/playCounts';

describe('bumpPlay', () => {
  it('records a first play with count 1, tags, and timestamp', () => {
    const next = bumpPlay({}, { id: 'a', tags: ['pop'] }, 1000);
    expect(next).toEqual({ a: { count: 1, tags: ['pop'], lastAt: 1000 } });
  });

  it('increments count and refreshes tags + lastAt on a repeat play', () => {
    const first = bumpPlay({}, { id: 'a', tags: ['pop'] }, 1000);
    const second = bumpPlay(first, { id: 'a', tags: ['pop', 'rock'] }, 2000);
    expect(second.a).toEqual({ count: 2, tags: ['pop', 'rock'], lastAt: 2000 });
  });

  it('keeps prior tags when a later play has none', () => {
    const first = bumpPlay({}, { id: 'a', tags: ['pop'] }, 1000);
    const second = bumpPlay(first, { id: 'a' }, 2000);
    expect(second.a.tags).toEqual(['pop']);
  });

  it('does not mutate the input map', () => {
    const input: PlayCounts = {};
    bumpPlay(input, { id: 'a', tags: [] }, 1000);
    expect(input).toEqual({});
  });
});

describe('parsePlayCounts', () => {
  it('parses a valid object', () => {
    const raw = JSON.stringify({ a: { count: 2, tags: ['pop'], lastAt: 5 } });
    expect(parsePlayCounts(raw)).toEqual({ a: { count: 2, tags: ['pop'], lastAt: 5 } });
  });

  it('returns {} for null, arrays, and invalid JSON', () => {
    expect(parsePlayCounts(null)).toEqual({});
    expect(parsePlayCounts('[]')).toEqual({});
    expect(parsePlayCounts('not json')).toEqual({});
  });
});
