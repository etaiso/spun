'use client';

// Persists the now-playing session (current track + playlist history) per
// station so it can be restored both on reload AND when switching back to a
// station you were just listening to — unless it's gone stale. Radio metadata
// moves on, so a session older than STALE_MS is discarded (and pruned): the
// song almost certainly changed since.

import type { TrackSource, HistoryEntry } from './nowPlayingTypes';

const KEY = 'radio:sessions';
const STALE_MS = 5 * 60_000; // 5 minutes

export type SessionState = {
  current: { raw: string; source: TrackSource; cover: string | null } | null;
  history: HistoryEntry[];
  lastUpdate: string | null;
};

type Entry = SessionState & { updatedAt: number };
type Store = Record<string, Entry>;

function readStore(): Store {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) || '{}') as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // best-effort persistence
  }
}

/** Load the saved session for `stationId`, or null if missing or stale. */
export function loadSession(stationId: string): SessionState | null {
  const e = readStore()[stationId];
  if (!e) return null;
  if (Date.now() - e.updatedAt > STALE_MS) return null;
  return { current: e.current, history: e.history, lastUpdate: e.lastUpdate };
}

/**
 * Save the session for `stationId`, stamped now. Also prunes any entries that
 * have gone stale, keeping the store from growing without bound.
 */
export function saveSession(stationId: string, state: SessionState): void {
  if (typeof window === 'undefined') return;
  const store = readStore();
  const now = Date.now();
  for (const id of Object.keys(store)) {
    if (id !== stationId && now - store[id].updatedAt > STALE_MS) delete store[id];
  }
  store[stationId] = { ...state, updatedAt: now };
  writeStore(store);
}
