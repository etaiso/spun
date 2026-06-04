'use client';

import { fuzzyScore } from './rank';

export type SavedSong = {
  id: string;            // Shazam key, else normalized `${artist}|${title}`
  title: string;
  artist: string;
  raw: string;
  cover: string;
  shazamUrl: string;
  appleMusicUrl: string;
  previewUrl: string;
  stationName: string;
  savedAt: number;
};

export type BuildInput = {
  raw: string;
  artist: string;
  title: string;
  cover?: string;
  shazamUrl?: string;
  appleMusicUrl?: string;
  previewUrl?: string;
  key?: string;
  stationName: string;
  savedAt: number;
};

/** Build a SavedSong, filling search-URL fallbacks for metadata-only tracks. */
export function buildSavedSong(input: BuildInput): SavedSong {
  const term = ([input.artist, input.title].filter(Boolean).join(' ').trim()) || input.raw;
  const norm = (s: string) => s.trim().toLowerCase();
  const id = input.key && input.key.trim()
    ? input.key.trim()
    : `${norm(input.artist)}|${norm(input.title)}`;
  return {
    id,
    title: input.title,
    artist: input.artist,
    raw: input.raw,
    cover: input.cover || '',
    shazamUrl: input.shazamUrl || `https://www.shazam.com/search/${encodeURIComponent(term)}`,
    appleMusicUrl: input.appleMusicUrl || `https://music.apple.com/search?term=${encodeURIComponent(term)}`,
    previewUrl: input.previewUrl || '',
    stationName: input.stationName,
    savedAt: input.savedAt,
  };
}

/** Prepend a song, de-duping by id (existing entry wins; no reorder churn). */
export function addSong(list: SavedSong[], song: SavedSong): SavedSong[] {
  if (list.some(s => s.id === song.id)) return list;
  return [song, ...list];
}

export function removeSong(list: SavedSong[], id: string): SavedSong[] {
  return list.filter(s => s.id !== id);
}

/** Fuzzy filter by "Artist - Title". Empty query → original list unchanged. */
export function searchSavedSongs(list: SavedSong[], query: string): SavedSong[] {
  const q = query.trim();
  if (!q) return list;
  return list
    .map(s => ({ s, score: fuzzyScore(q, s.raw) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.s.savedAt - a.s.savedAt)
    .map(x => x.s);
}
