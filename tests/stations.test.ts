import { describe, it, expect } from 'vitest';
import { normalizeStation } from '../app/lib/stations';

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
