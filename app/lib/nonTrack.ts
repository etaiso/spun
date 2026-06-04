// Substrings that mark broadcast metadata as station/CDN branding or filler
// rather than an actual song (case-insensitive). Some stations park their CDN
// or "now playing" channel on text like "Powered By Multix Technologies CDN",
// which we don't want to show as a song (and which should let Shazam try
// instead). Kept conservative so real titles aren't dropped.
const JUNK_MARKERS = [
  'powered by',
  'multix',
  'advertisement',
  'commercial break',
];

/** True when a broadcast title is clearly branding/filler, not a song. */
export function isJunkMetadata(title: string): boolean {
  const t = title.trim().toLowerCase();
  if (t === '') return true;
  return JUNK_MARKERS.some(m => t.includes(m));
}

export function isNonTrack(title: string, stationName: string): boolean {
  const t = title.trim();
  if (t === '') return true;
  if (t.toLowerCase() === stationName.trim().toLowerCase()) return true;
  if (!t.includes('-') && !t.includes('—') && t.length < 4) return true;
  if (isJunkMetadata(t)) return true;
  return false;
}
