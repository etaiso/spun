// Pure track-matching for Spotify export: decide which Spotify track (if any) a
// saved song corresponds to. ISRC gives an exact hit; otherwise a normalized
// title+artist similarity must clear a confidence threshold, so we never insert
// a wrong track — below the bar the caller flags the song "not found".
//
// No network, no React — unit-tested in tests/spotifyMatch.test.ts.

import { fuzzyScore } from '../rank';
import type { TrackQuery } from './types';

export type Candidate = {
  id: string;
  uri: string;          // spotify:track:<id>
  url: string;          // open.spotify.com link
  name: string;
  artists: string[];
  isrc?: string;
  durationMs?: number;
};

/** Minimum combined score to accept a (non-ISRC) match. Tuned against the tests. */
export const MATCH_THRESHOLD = 0.72;

/** Lowercase; drop "(feat. …)" / trailing "feat …" / "- Remastered/Live/…" tags and punctuation. */
export function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\(feat\.?[^)]*\)/g, ' ')
    .replace(/\bfeat\.?\b.*$/g, ' ')
    .replace(/-\s*(remaster(ed)?|live|mono|stereo|radio edit|single version)[^-]*$/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ISRC filter when known (exact), else a track+artist field query. */
export function buildSearchQuery(q: TrackQuery): string {
  if (q.isrc && q.isrc.trim()) return `isrc:${q.isrc.trim()}`;
  const t = q.title.replace(/"/g, ' ').trim();
  const a = q.artist.replace(/"/g, ' ').trim();
  return [t && `track:"${t}"`, a && `artist:"${a}"`].filter(Boolean).join(' ');
}

/** 0..1. ISRC equality short-circuits to 1; otherwise weighted title (0.6) + artist (0.4). */
export function scoreCandidate(q: TrackQuery, c: Candidate): number {
  if (q.isrc && c.isrc && q.isrc.trim().toUpperCase() === c.isrc.trim().toUpperCase()) return 1;
  const title = fuzzyScore(normalize(q.title), normalize(c.name)); // already 0..1
  const artist = c.artists.length
    ? Math.max(...c.artists.map(a => fuzzyScore(normalize(q.artist), normalize(a))))
    : 0;
  return 0.6 * title + 0.4 * artist;
}

/** Highest-scoring candidate, or null if none clears MATCH_THRESHOLD. */
export function pickBestMatch(q: TrackQuery, candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = scoreCandidate(q, c);
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}
