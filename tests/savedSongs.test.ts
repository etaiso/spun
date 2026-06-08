import { describe, it, expect } from 'vitest';
import { buildSavedSong, addSong, removeSong, searchSavedSongs } from '../app/lib/savedSongs';
import type { SavedSong } from '../app/lib/savedSongs';

const base = {
  raw: 'Tracy Chapman - Fast Car',
  artist: 'Tracy Chapman',
  title: 'Fast Car',
  cover: 'http://cover/1',
  stationName: 'Radio Paradise',
  savedAt: 1000,
};

describe('buildSavedSong', () => {
  it('uses the Shazam key as id and keeps direct links when present', () => {
    const s = buildSavedSong({ ...base, key: '12345', shazamUrl: 'https://shz/x', appleMusicUrl: 'https://am/x', previewUrl: 'https://p/x.m4a' });
    expect(s.id).toBe('12345');
    expect(s.shazamUrl).toBe('https://shz/x');
    expect(s.appleMusicUrl).toBe('https://am/x');
    expect(s.previewUrl).toBe('https://p/x.m4a');
  });

  it('falls back to a normalized artist|title id and search URLs when links are missing', () => {
    const s = buildSavedSong({ ...base, key: '', shazamUrl: '', appleMusicUrl: '', previewUrl: '' });
    expect(s.id).toBe('tracy chapman|fast car');
    expect(s.shazamUrl).toBe('https://www.shazam.com/search/' + encodeURIComponent('Tracy Chapman Fast Car'));
    expect(s.appleMusicUrl).toBe('https://music.apple.com/search?term=' + encodeURIComponent('Tracy Chapman Fast Car'));
    expect(s.previewUrl).toBe('');
  });

  it('passes a trimmed isrc through when supplied, and omits the field otherwise', () => {
    expect(buildSavedSong({ ...base, isrc: '  USCM51900012 ' }).isrc).toBe('USCM51900012');
    expect('isrc' in buildSavedSong(base)).toBe(false);
  });

  it('passes playedAt through when supplied, and omits the field otherwise', () => {
    expect(buildSavedSong({ ...base, playedAt: 5000 }).playedAt).toBe(5000);
    expect('playedAt' in buildSavedSong(base)).toBe(false);
  });
});

describe('addSong / removeSong', () => {
  it('prepends, de-dupes by id, and removes by id', () => {
    const a = buildSavedSong({ ...base, key: 'A' });
    const b = buildSavedSong({ ...base, key: 'B', raw: 'Toto - Africa', artist: 'Toto', title: 'Africa', savedAt: 2000 });
    let list: SavedSong[] = [];
    list = addSong(list, a);
    list = addSong(list, b);
    expect(list.map(s => s.id)).toEqual(['B', 'A']); // newest first
    list = addSong(list, a); // dup → no change
    expect(list.length).toBe(2);
    list = removeSong(list, 'A');
    expect(list.map(s => s.id)).toEqual(['B']);
  });

  it('de-dupes the same song saved from different sources (Shazam key vs artist|title)', () => {
    // Now-playing card saves with a Shazam key id; playlist history saves the
    // same track with a normalized artist|title id. They must not both persist.
    const fromCard = buildSavedSong({ ...base, key: 'shz-99' });
    const fromHistory = buildSavedSong({ ...base, key: '' }); // id = 'tracy chapman|fast car'
    expect(fromCard.id).not.toBe(fromHistory.id);
    let list: SavedSong[] = [];
    list = addSong(list, fromCard);
    list = addSong(list, fromHistory); // same artist/title → deduped
    expect(list.map(s => s.id)).toEqual(['shz-99']);
  });
});

describe('searchSavedSongs', () => {
  const a = buildSavedSong({ ...base, key: 'A' }); // Tracy Chapman - Fast Car
  const b = buildSavedSong({ ...base, key: 'B', raw: 'Toto - Africa', artist: 'Toto', title: 'Africa' });
  const list = [b, a];

  it('returns the full list (unchanged order) for an empty query', () => {
    expect(searchSavedSongs(list, '   ')).toEqual(list);
  });

  it('filters to fuzzy matches', () => {
    const r = searchSavedSongs(list, 'africa');
    expect(r.map(s => s.id)).toEqual(['B']);
  });
});
