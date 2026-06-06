'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { persistSet } from './persist';

// Whether newly saved songs are automatically appended to the Spotify "Spun"
// playlist. Persisted (SQLite-backed, like the other settings), on by default —
// only an explicit '0' disables it. Purely a renderer-side behavior: it gates
// whether a save triggers spotifySync, so (unlike autoUpdate) there's nothing to
// mirror to the Electron main process.

const KEY = 'radio:spotifyAutoSync';

function loadFromStorage(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

let snapshot: boolean | null = null;
function read(): boolean {
  if (snapshot === null) snapshot = loadFromStorage();
  return snapshot;
}

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { snapshot = loadFromStorage(); cb(); } };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

function write(next: boolean) {
  snapshot = next;
  persistSet(KEY, next ? '1' : '0');
  for (const cb of listeners) cb();
}

/** Read the current preference outside React (e.g. in a save handler). */
export function autoSyncEnabled(): boolean {
  return read();
}

export function useSpotifyAutoSync() {
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  const setEnabled = useCallback((v: boolean) => write(v), []);
  const toggle = useCallback(() => write(!read()), []);
  return { enabled, setEnabled, toggle };
}
