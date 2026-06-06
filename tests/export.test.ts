import { describe, it, expect } from 'vitest';
import { toCsv, toM3u8, buildExport } from '../app/lib/integrations/export';
import { buildSavedSong } from '../app/lib/savedSongs';
import type { SavedSong } from '../app/lib/savedSongs';

const songs: SavedSong[] = [
  buildSavedSong({
    raw: 'Tracy Chapman - Fast Car', artist: 'Tracy Chapman', title: 'Fast Car',
    appleMusicUrl: 'https://music.apple.com/x', isrc: 'USPR37300012',
    stationName: 'Radio Paradise', savedAt: 0,
  }),
  // Title with a comma + quote to exercise CSV escaping; no isrc.
  buildSavedSong({
    raw: 'AC/DC - Shoot to Thrill', artist: 'AC/DC', title: 'Shoot to Thrill, "Live"',
    appleMusicUrl: 'https://music.apple.com/y', stationName: 'Rock FM', savedAt: 60000,
  }),
];

describe('toCsv', () => {
  it('emits a header, one CRLF-terminated row per song, and an empty ISRC when absent', () => {
    const lines = toCsv(songs).split('\r\n');
    expect(lines[0]).toBe('Title,Artist,ISRC,Apple Music URL,Station,Saved');
    expect(lines[1]).toBe('Fast Car,Tracy Chapman,USPR37300012,https://music.apple.com/x,Radio Paradise,1970-01-01T00:00:00.000Z');
    expect(lines[3]).toBe(''); // trailing CRLF
  });

  it('quotes fields containing commas/quotes and doubles inner quotes', () => {
    const row = toCsv([songs[1]]).split('\r\n')[1];
    expect(row).toContain('"Shoot to Thrill, ""Live"""');
    expect(row).toContain('AC/DC'); // slash needs no quoting
  });
});

describe('toM3u8', () => {
  it('starts with #EXTM3U and pairs an EXTINF label with a URI per song', () => {
    const lines = toM3u8(songs).split('\n');
    expect(lines[0]).toBe('#EXTM3U');
    expect(lines[1]).toBe('#EXTINF:-1,Tracy Chapman - Fast Car');
    expect(lines[2]).toBe('https://music.apple.com/x');
  });
});

describe('buildExport', () => {
  it('maps formats to filename + mime', () => {
    expect(buildExport(songs, 'csv')).toMatchObject({ filename: 'spun-saved-songs.csv', mime: 'text/csv;charset=utf-8' });
    expect(buildExport(songs, 'm3u8')).toMatchObject({ filename: 'spun-saved-songs.m3u8', mime: 'audio/x-mpegurl' });
  });
});
