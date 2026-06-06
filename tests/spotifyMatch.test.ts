import { describe, it, expect } from 'vitest';
import {
  normalize, buildSearchQuery, scoreCandidate, pickBestMatch,
  MATCH_THRESHOLD, type Candidate,
} from '../app/lib/integrations/spotifyMatch';

const song = { artist: 'Tracy Chapman', title: 'Fast Car' };
const cand = (over: Partial<Candidate>): Candidate => ({
  id: 'id', uri: 'spotify:track:id', url: 'https://open.spotify.com/track/id',
  name: 'Fast Car', artists: ['Tracy Chapman'], ...over,
});

describe('normalize', () => {
  it('strips feat / remaster tags and punctuation, collapses whitespace', () => {
    expect(normalize('Fast Car (feat. Someone)')).toBe('fast car');
    expect(normalize('Song - Remastered 2011')).toBe('song');
    expect(normalize('Hello!!  World?')).toBe('hello world');
  });
});

describe('buildSearchQuery', () => {
  it('prefers an ISRC filter when present', () => {
    expect(buildSearchQuery({ ...song, isrc: 'USPR37300012' })).toBe('isrc:USPR37300012');
  });
  it('falls back to a track + artist field query', () => {
    expect(buildSearchQuery(song)).toBe('track:"Fast Car" artist:"Tracy Chapman"');
  });
});

describe('scoreCandidate', () => {
  it('returns 1 on ISRC equality regardless of text', () => {
    const s = scoreCandidate({ ...song, isrc: 'uspr37300012' }, cand({ name: 'X', artists: ['Y'], isrc: 'USPR37300012' }));
    expect(s).toBe(1);
  });
  it('scores an exact title+artist match at the top', () => {
    expect(scoreCandidate(song, cand({}))).toBeCloseTo(1, 5);
  });
  it('scores an unrelated track below the threshold', () => {
    expect(scoreCandidate(song, cand({ name: 'Completely Different', artists: ['Other Band'] }))).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('pickBestMatch', () => {
  it('returns the best candidate at or above the threshold', () => {
    const best = pickBestMatch(song, [
      cand({ id: 'wrong', name: 'Slow Bike', artists: ['Nobody'] }),
      cand({ id: 'right' }),
    ]);
    expect(best?.id).toBe('right');
  });
  it('returns null when nothing clears the threshold', () => {
    expect(pickBestMatch(song, [cand({ name: 'Zzz', artists: ['Qqq'] })])).toBeNull();
  });
});
