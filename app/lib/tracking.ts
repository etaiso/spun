'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { Station } from './stations';

// Stations the user is "tracking" — the app watches what each is playing in the
// background (via a per-station /api/now-playing SSE, same mechanism as the
// active station) without playing their audio. Persisted like favorites.

const KEY = 'radio:tracking';
const EMPTY: Station[] = [];

function loadFromStorage(): Station[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Station[]) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let snapshot: Station[] | null = null;
function read(): Station[] {
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

function write(next: Station[]) {
  snapshot = next;
  try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* best-effort */ }
  emit();
}

export function useTracking() {
  const tracked = useSyncExternalStore(subscribe, read, () => EMPTY);

  const isTracked = useCallback((id: string) => tracked.some(s => s.id === id), [tracked]);

  const track = useCallback((station: Station) => {
    const current = read();
    if (current.some(s => s.id === station.id)) return;
    write([station, ...current]);
  }, []);

  const untrack = useCallback((id: string) => {
    write(read().filter(s => s.id !== id));
  }, []);

  return { tracked, isTracked, track, untrack };
}
