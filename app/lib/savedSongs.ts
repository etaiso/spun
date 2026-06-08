'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { fuzzyScore } from './rank';
import { persistSet } from './persist';

/**
 * Per-song state of the playlist-export integration (Spotify first).
 * Absent means "not yet processed" — treated as pending once a provider is
 * connected. `not_found` = no confident match; `skipped` = user excluded it.
 */
export type SyncState = 'pending' | 'synced' | 'not_found' | 'skipped';

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
  /** When the track aired (its play time). Absent on songs saved before
   *  play-time tracking existed — callers fall back to savedAt. */
  playedAt?: number;
  // --- Playlist-export integration (additive; iTunes fields above untouched) ---
  isrc?: string;         // exact cross-provider match key, when the recognizer supplies it
  spotifyTrackId?: string;
  spotifyUrl?: string;   // "Open in Spotify" link, resolved at save time when connected
  syncState?: SyncState;
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
  isrc?: string;
  stationName: string;
  savedAt: number;
  playedAt?: number;
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
    ...(input.playedAt != null ? { playedAt: input.playedAt } : {}),
    ...(input.isrc && input.isrc.trim() ? { isrc: input.isrc.trim() } : {}),
  };
}

/** Normalized cross-source identity. The now-playing card saves with a Shazam
 *  key as `id` while playlist history saves with `${artist}|${title}` — without
 *  this the same song would dedupe-miss and be stored twice. */
export const matchKey = (artist: string, title: string) =>
  `${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;

/** Prepend a song, de-duping by id *or* artist/title (existing entry wins; no
 *  reorder churn). The matchKey check catches the same track saved from
 *  different sources whose ids differ (Shazam key vs. artist|title). */
export function addSong(list: SavedSong[], song: SavedSong): SavedSong[] {
  const mk = matchKey(song.artist, song.title);
  if (list.some(s => s.id === song.id || matchKey(s.artist, s.title) === mk)) return list;
  return [song, ...list];
}

export function removeSong(list: SavedSong[], id: string): SavedSong[] {
  return list.filter(s => s.id !== id);
}

/** Patch a saved song in place (preserves order; no-op if id not found). */
export function updateSong(list: SavedSong[], id: string, patch: Partial<SavedSong>): SavedSong[] {
  let changed = false;
  const next = list.map(s => {
    if (s.id !== id) return s;
    changed = true;
    return { ...s, ...patch };
  });
  return changed ? next : list;
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

const KEY = 'radio:savedSongs';
const EMPTY: SavedSong[] = [];

function load(): SavedSong[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedSong[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let snapshot: SavedSong[] | null = null;
function read(): SavedSong[] {
  if (snapshot === null) snapshot = load();
  return snapshot;
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { snapshot = load(); cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function write(next: SavedSong[]) {
  snapshot = next;
  persistSet(KEY, JSON.stringify(next));
  for (const cb of listeners) cb();
}

export function useSavedSongs() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);
  const isSaved = useCallback((id: string) => saved.some(s => s.id === id), [saved]);
  // Find a saved entry by song identity (artist/title), regardless of which
  // source saved it or what its stored `id` is. Lets the now-playing card and
  // playlist-history rows agree on saved-state and remove the right entry.
  const savedSong = useCallback(
    (artist: string, title: string) => {
      const mk = matchKey(artist, title);
      return saved.find(s => matchKey(s.artist, s.title) === mk);
    },
    [saved],
  );
  // Stamp savedAt at call time; build + de-dupe via the pure helpers.
  const save = useCallback((input: Omit<BuildInput, 'savedAt'>) => {
    write(addSong(read(), buildSavedSong({ ...input, savedAt: Date.now() })));
  }, []);
  const remove = useCallback((id: string) => { write(removeSong(read(), id)); }, []);
  const update = useCallback((id: string, patch: Partial<SavedSong>) => {
    write(updateSong(read(), id, patch));
  }, []);
  return { saved, isSaved, savedSong, save, remove, update };
}
