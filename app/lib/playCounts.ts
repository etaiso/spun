'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { persistSet } from './persist';

// Per-station play tally — how many times the user has started each station,
// plus its genre tags at play time. Feeds the genre-affinity profile in
// lib/taste.ts. Persisted like favorites/recent: a localStorage cache mirrored
// (debounced) to the SQLite-backed /api/state, rehydrated on boot.

export type PlayCount = { count: number; tags: string[]; lastAt: number };
export type PlayCounts = Record<string, PlayCount>;

const KEY = 'radio:playCounts';
const EMPTY: PlayCounts = {};

/** Pure: record one play of `station`, returning a NEW map (input untouched). */
export function bumpPlay(
  counts: PlayCounts,
  station: { id: string; tags?: string[] },
  now: number,
): PlayCounts {
  const prev = counts[station.id];
  return {
    ...counts,
    [station.id]: {
      count: (prev?.count ?? 0) + 1,
      tags: station.tags ?? prev?.tags ?? [],
      lastAt: now,
    },
  };
}

/** Pure: tolerant parse of the stored value into a PlayCounts map. */
export function parsePlayCounts(raw: string | null): PlayCounts {
  if (!raw) return {};
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as PlayCounts)
      : {};
  } catch {
    return {};
  }
}

function loadFromStorage(): PlayCounts {
  if (typeof window === 'undefined') return EMPTY;
  return parsePlayCounts(window.localStorage.getItem(KEY));
}

let snapshot: PlayCounts | null = null;
function read(): PlayCounts {
  if (snapshot === null) snapshot = loadFromStorage();
  return snapshot;
}

const listeners = new Set<() => void>();
function emit() { for (const cb of listeners) cb(); }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) { snapshot = loadFromStorage(); cb(); }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function write(next: PlayCounts) {
  snapshot = next;
  persistSet(KEY, JSON.stringify(next));
  emit();
}

export function usePlayCounts() {
  const counts = useSyncExternalStore(subscribe, read, () => EMPTY);
  const bump = useCallback((station: { id: string; tags?: string[] }) => {
    write(bumpPlay(read(), station, Date.now()));
  }, []);
  return { counts, bump };
}
