// Portable, gate-free export of saved songs to standard playlist files the user
// can import into any service (directly, or via transfer tools like Soundiiz /
// TuneMyMusic). No auth, no API keys, no provider account — works for everyone.
//
// Pure string builders only (no DOM, no network) so they're trivially testable;
// the browser download is triggered by the caller.

import type { SavedSong } from '../savedSongs';

/** RFC 4180: quote a field containing a comma, quote, CR or LF; escape quotes by doubling. */
function csvField(value: string): string {
  const v = value ?? '';
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const CSV_HEADER = ['Title', 'Artist', 'ISRC', 'Apple Music URL', 'Station', 'Saved'];

/**
 * CSV of saved songs. Title + Artist (and ISRC when present) are what
 * playlist-transfer tools match on; the rest is provenance. CRLF line endings
 * per the CSV spec.
 */
export function toCsv(songs: SavedSong[]): string {
  const rows = songs.map(s => [
    s.title,
    s.artist,
    s.isrc ?? '',
    s.appleMusicUrl,
    s.stationName,
    new Date(s.savedAt).toISOString(),
  ].map(csvField).join(','));
  return [CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}

/** Strip CR/LF so a label can't break the line-oriented M3U format. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Extended M3U8 playlist. `#EXTINF` carries "Artist - Title" (what most
 * importers read); the URI line is the song's best known link.
 */
export function toM3u8(songs: SavedSong[]): string {
  const lines = ['#EXTM3U'];
  for (const s of songs) {
    const label = oneLine([s.artist, s.title].filter(Boolean).join(' - ') || s.raw || s.title);
    lines.push(`#EXTINF:-1,${label}`);
    lines.push(s.appleMusicUrl || s.shazamUrl || '');
  }
  return lines.join('\n') + '\n';
}

export type ExportFormat = 'csv' | 'm3u8';

/** Filename + MIME + serialized content for a given format. */
export function buildExport(songs: SavedSong[], format: ExportFormat): {
  filename: string;
  mime: string;
  content: string;
} {
  return format === 'csv'
    ? { filename: 'spun-saved-songs.csv', mime: 'text/csv;charset=utf-8', content: toCsv(songs) }
    : { filename: 'spun-saved-songs.m3u8', mime: 'audio/x-mpegurl', content: toM3u8(songs) };
}
