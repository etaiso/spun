import { describe, it, expect } from 'vitest';
import { normalizeStation, parseStoredStations } from '../app/lib/stations';

describe('normalizeStation', () => {
  it('maps radio-browser fields to our Station shape', () => {
    const raw = {
      stationuuid: 'abc-123',
      name: '  KEXP  ',
      url_resolved: 'https://kexp.example/stream',
      url: 'http://kexp.example/playlist.pls',
      favicon: 'https://kexp.example/logo.png',
      country: 'United States',
      countrycode: 'us',
      bitrate: 128,
      codec: 'MP3',
    };
    expect(normalizeStation(raw)).toEqual({
      id: 'abc-123',
      name: 'KEXP',
      streamUrl: 'https://kexp.example/stream',
      favicon: 'https://kexp.example/logo.png',
      country: 'United States',
      countrycode: 'US',
      bitrate: 128,
      codec: 'MP3',
    });
  });

  it('uppercases the country code', () => {
    const raw = {
      stationuuid: 'x', name: 'X', url_resolved: 'http://x', url: '',
      favicon: '', country: 'Israel', countrycode: 'il', bitrate: 0, codec: '',
    };
    expect(normalizeStation(raw).countrycode).toBe('IL');
  });

  it('does not throw on null or missing name', () => {
    const raw = {
      stationuuid: 'x',
      name: null as unknown as string,
      url_resolved: 'http://x',
      url: '',
      favicon: '',
      country: '',
      countrycode: '',
      bitrate: 0,
      codec: '',
    };
    expect(normalizeStation(raw).name).toBe('');
  });

  it('falls back to url when url_resolved is empty', () => {
    const raw = {
      stationuuid: 'x',
      name: 'X',
      url_resolved: '',
      url: 'http://fallback/stream',
      favicon: '',
      country: '',
      countrycode: '',
      bitrate: 0,
      codec: '',
    };
    expect(normalizeStation(raw).streamUrl).toBe('http://fallback/stream');
  });
});

describe('parseStoredStations', () => {
  const valid = {
    id: 'a', name: 'KEXP', streamUrl: 'http://x/s', favicon: '',
    country: 'US', countrycode: 'US', bitrate: 128, codec: 'MP3',
  };

  it('keeps well-formed stations', () => {
    expect(parseStoredStations(JSON.stringify([valid]))).toEqual([valid]);
  });

  it('drops entries missing a name or stream url (legacy/partial data)', () => {
    const raw = JSON.stringify([
      valid,
      { id: 'durable-test' },                          // stray test junk
      { ...valid, id: 'b', name: null },               // null name
      { ...valid, id: 'c', name: '   ' },              // blank name
      { ...valid, id: 'd', streamUrl: '' },            // unplayable
    ]);
    expect(parseStoredStations(raw).map(s => s.id)).toEqual(['a']);
  });

  it('drops null and non-object array members', () => {
    const raw = JSON.stringify([valid, null, 42, 'nope']);
    expect(parseStoredStations(raw).map(s => s.id)).toEqual(['a']);
  });

  it('returns [] for null, non-arrays, and invalid JSON', () => {
    expect(parseStoredStations(null)).toEqual([]);
    expect(parseStoredStations('{}')).toEqual([]);
    expect(parseStoredStations('not json')).toEqual([]);
  });
});

describe('normalizeStation tags', () => {
  const raw = {
    stationuuid: 'x', name: 'X', url_resolved: 'http://x', url: '',
    favicon: '', country: '', countrycode: '', bitrate: 0, codec: '',
  };

  it('parses comma-separated tags into a lowercased, trimmed array', () => {
    expect(normalizeStation({ ...raw, tags: 'Pop, Rock ,news' }).tags).toEqual(['pop', 'rock', 'news']);
  });

  it('omits the tags field entirely when there are none', () => {
    expect('tags' in normalizeStation(raw)).toBe(false);
    expect('tags' in normalizeStation({ ...raw, tags: '' })).toBe(false);
    expect('tags' in normalizeStation({ ...raw, tags: ' , , ' })).toBe(false);
  });

  it('dedupes and caps tags at 8', () => {
    const tags = 'a,a,b,c,d,e,f,g,h,i,j';
    expect(normalizeStation({ ...raw, tags }).tags).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });
});
