'use client';

import { useCallback, useSyncExternalStore } from 'react';
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
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  for (const cb of listeners) cb();
}

export function useSavedSongs() {
  const saved = useSyncExternalStore(subscribe, read, () => EMPTY);
  const isSaved = useCallback((id: string) => saved.some(s => s.id === id), [saved]);
  // Stamp savedAt at call time; build + de-dupe via the pure helpers.
  const save = useCallback((input: Omit<BuildInput, 'savedAt'>) => {
    write(addSong(read(), buildSavedSong({ ...input, savedAt: Date.now() })));
  }, []);
  const remove = useCallback((id: string) => { write(removeSong(read(), id)); }, []);
  const update = useCallback((id: string, patch: Partial<SavedSong>) => {
    write(updateSong(read(), id, patch));
  }, []);
  return { saved, isSaved, save, remove, update };
}
