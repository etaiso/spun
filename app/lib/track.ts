// Split a raw "Artist - Title" string into parts. Shared by the now-playing
// panel and the playlist-history list.
export function splitArtistTitle(raw: string): { artist: string; title: string } {
  // Try separators in order of confidence: em-dash and en-dash are
  // unambiguous; ASCII hyphen is only used if the left side has no hyphen
  // (avoids miscategorizing titles like "Song - Live Version").
  for (const sep of [' — ', ' – '] as const) {
    if (raw.includes(sep)) {
      const [artist, ...rest] = raw.split(sep);
      return { artist: artist.trim(), title: rest.join(sep).trim() };
    }
  }
  const hyphenIdx = raw.indexOf(' - ');
  if (hyphenIdx > 0 && !raw.slice(0, hyphenIdx).includes('-')) {
    const artist = raw.slice(0, hyphenIdx);
    const title = raw.slice(hyphenIdx + 3);
    return { artist: artist.trim(), title: title.trim() };
  }
  return { artist: '', title: raw };
}
